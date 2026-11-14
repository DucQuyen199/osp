//! SMTP adapter using implicit TLS or mandatory STARTTLS.
use super::Failure;
use crate::error::{ApiError, R};
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message as EmailMessage, Tokio1Executor,
    message::{Mailbox, header::ContentType},
    transport::smtp::authentication::Credentials,
};
use std::{env, time::Duration};

pub(super) struct SmtpSender {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: Mailbox,
}

impl SmtpSender {
    pub(super) fn from_env() -> R<Option<Self>> {
        let host = env::var("OSP_COMM_SMTP_HOST")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let Some(host) = host else {
            let partial = [
                "OSP_COMM_SMTP_PORT",
                "OSP_COMM_SMTP_USERNAME",
                "OSP_COMM_SMTP_PASSWORD",
            ]
            .iter()
            .any(|key| env::var(key).is_ok_and(|value| !value.trim().is_empty()))
                || env::var("OSP_COMM_SMTP_MODE").is_ok_and(|value| {
                    let value = value.trim();
                    !value.is_empty() && !value.eq_ignore_ascii_case("implicit_tls")
                });
            return if partial {
                Err(config_error(
                    "SMTP options require OSP_COMM_SMTP_HOST to be configured",
                ))
            } else {
                Ok(None)
            };
        };
        if host.contains(['/', '@', '\\']) || host.chars().any(char::is_whitespace) {
            return Err(config_error("OSP_COMM_SMTP_HOST must be a hostname only"));
        }

        let mode = env::var("OSP_COMM_SMTP_MODE")
            .unwrap_or_else(|_| "implicit_tls".into())
            .trim()
            .to_ascii_lowercase();
        let default_port = match mode.as_str() {
            "implicit_tls" => 465,
            "starttls" => 587,
            _ => {
                return Err(config_error(
                    "OSP_COMM_SMTP_MODE must be implicit_tls or starttls",
                ));
            }
        };
        let port = env::var("OSP_COMM_SMTP_PORT")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(|value| {
                value
                    .trim()
                    .parse::<u16>()
                    .ok()
                    .filter(|port| *port > 0)
                    .ok_or_else(|| config_error("OSP_COMM_SMTP_PORT must be between 1 and 65535"))
            })
            .transpose()?
            .unwrap_or(default_port);

        let from = env::var("OSP_COMM_EMAIL_FROM")
            .ok()
            .and_then(|value| value.parse::<Mailbox>().ok())
            .ok_or_else(|| config_error("OSP_COMM_EMAIL_FROM must be a valid email address"))?;
        let username = env::var("OSP_COMM_SMTP_USERNAME")
            .ok()
            .filter(|value| !value.is_empty());
        let password = env::var("OSP_COMM_SMTP_PASSWORD")
            .ok()
            .filter(|value| !value.is_empty());
        if username.is_some() != password.is_some() {
            return Err(config_error(
                "SMTP username and password must either both be set or both be empty",
            ));
        }

        let mut builder = match mode.as_str() {
            "implicit_tls" => AsyncSmtpTransport::<Tokio1Executor>::relay(&host),
            "starttls" => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&host),
            _ => unreachable!("SMTP mode was validated above"),
        }
        .map_err(|_| config_error("SMTP host or TLS configuration is invalid"))?
        .port(port)
        .timeout(Some(Duration::from_secs(20)));
        if let (Some(username), Some(password)) = (username, password) {
            builder = builder.credentials(Credentials::new(username, password));
        }
        Ok(Some(Self {
            transport: builder.build(),
            from,
        }))
    }

    pub(super) async fn send(
        &self,
        recipient: &str,
        subject: &str,
        body: &str,
    ) -> Result<(), Failure> {
        let to = recipient.parse::<Mailbox>().map_err(|_| Failure {
            retryable: false,
            message: "email recipient address is invalid",
        })?;
        let message = EmailMessage::builder()
            .from(self.from.clone())
            .to(to)
            .subject(subject)
            .header(ContentType::TEXT_PLAIN)
            .body(body.to_owned())
            .map_err(|_| Failure {
                retryable: false,
                message: "email message could not be encoded",
            })?;
        self.transport
            .send(message)
            .await
            .map_err(|error| Failure {
                retryable: !error.is_permanent(),
                message: if error.is_permanent() {
                    "SMTP server permanently rejected the message"
                } else {
                    "SMTP server temporarily failed to deliver the message"
                },
            })?;
        Ok(())
    }
}

fn config_error(message: &str) -> ApiError {
    ApiError::new(500, "MAIL_CONFIGURATION", message)
}
