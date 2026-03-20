const swaggerAutogen = require('swagger-autogen')();

const doc = {
  info: {
    title: 'My API',
    description: 'Description'
  },
  host: 'localhost:3004'
};

const outputFile = './swagger-output.json';
const routes = ['./src/app.ts'];

swaggerAutogen(outputFile, routes, doc);
