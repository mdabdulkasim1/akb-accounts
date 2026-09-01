'use strict';
require('dotenv').config();
const { migrate, seed } = require('../db');

(async () => {
  console.log('====================================================');
  console.log('    AKB ACCOUNTS - DATABASE SETUP (MIGRATE & SEED)  ');
  console.log('====================================================');
  try {
    await migrate(true);
    await seed(true);
    console.log('====================================================');
    console.log('       DATABASE SETUP COMPLETED SUCCESSFULLY        ');
    console.log('====================================================');
    process.exit(0);
  } catch (err) {
    console.error('Database setup failed:', err);
    process.exit(1);
  }
})();
