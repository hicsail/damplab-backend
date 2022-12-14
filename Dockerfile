FROM node:18

WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Copy over the source
COPY . .
RUN npm run build

# Expore the default port
EXPOSE 3000

CMD ["npm", "run", "start:prod"]
