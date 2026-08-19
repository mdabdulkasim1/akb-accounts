'use strict';
require('dotenv').config();
const { seed } = require('../db');

(async () => {
  console.log('====================================================');
  console.log('       AKB ACCOUNTS - DATABASE SEEDING             ');
  console.log('====================================================');
  try {
    await seed(true);
    console.log('====================================================');
    console.log('       SEEDING COMPLETED SUCCESSFULLY              ');
    console.log('====================================================');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
})();
