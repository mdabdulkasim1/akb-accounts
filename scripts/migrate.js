'use strict';
require('dotenv').config();
const { migrate } = require('../db');

(async () => {
  console.log('====================================================');
  console.log('       AKB ACCOUNTS - DATABASE MIGRATION           ');
  console.log('====================================================');
  try {
    await migrate(true);
    console.log('====================================================');
    console.log('       MIGRATIONS COMPLETED SUCCESSFULLY           ');
    console.log('====================================================');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
})();
