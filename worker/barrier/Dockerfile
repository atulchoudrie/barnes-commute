FROM node:22-alpine
WORKDIR /app
COPY package.json *.ts ./
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "--no-warnings", "server.ts"]
