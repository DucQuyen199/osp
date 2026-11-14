FROM postgres:17-alpine

COPY init.sh /docker-entrypoint-initdb.d/10-osp.sh
RUN chmod 0555 /docker-entrypoint-initdb.d/10-osp.sh
