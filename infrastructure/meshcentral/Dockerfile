FROM node:24.19.0-bookworm-slim
ARG MESH_VERSION=1.2.5
WORKDIR /opt/meshcentral
RUN npm install --omit=dev --save-exact meshcentral@${MESH_VERSION}
EXPOSE 4430
USER node
CMD ["node","node_modules/meshcentral"]
