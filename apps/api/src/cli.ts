import { runReview } from './review.js';
import { closeConnections } from './db.js';

runReview().catch(() => {
  console.error('Review command failed. Check services, arguments and provider availability.');
  process.exitCode = 1;
}).finally(closeConnections);
