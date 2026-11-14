export const recordHref = (qname, id) => {
  const separator = qname.indexOf('.');
  return `#/e/${qname.slice(0, separator)}/${qname.slice(separator + 1)}/${id}`;
};

export const listHref = (qname) => {
  const separator = qname.indexOf('.');
  return `#/e/${qname.slice(0, separator)}/${qname.slice(separator + 1)}`;
};
