import { runBootstrap } from './lib/bootstrap';

async function main() {
  try {
    await runBootstrap();
    console.warn('[seed] Database seeded successfully.');
    process.exit(0);
  } catch (error) {
    console.error('[seed] Error seeding database:', error);
    process.exit(1);
  }
}

main();
