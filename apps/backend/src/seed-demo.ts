import { runBootstrap } from './lib/bootstrap'
import { seedDemoData } from './lib/bootstrap/demo'

async function main() {
  try {
    // Migrations and the root user first: the demo data hangs off both.
    await runBootstrap()
    await seedDemoData()
    process.exit(0)
  } catch (error) {
    console.error('[demo] Error seeding demo data:', error)
    process.exit(1)
  }
}

main()
