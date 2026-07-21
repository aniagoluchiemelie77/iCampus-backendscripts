FROM node:18-slim

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies by copying package.json and package-lock.json
COPY package*.json ./

# Install dependencies (use npm ci for clean production installs)
RUN npm ci --only=production

# Bundle app source
COPY . .

# App Engine Flexible listens on port 8080 by default
ENV PORT=8080
EXPOSE 8080

# Start the application
CMD [ "npm", "start" ]