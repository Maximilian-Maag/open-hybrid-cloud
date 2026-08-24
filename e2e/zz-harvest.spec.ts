import { test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs'

const OUT = '/tmp/claude-1000/-home-mmaag-Git-open-hybrid-cloud/8dcde4c2-3ce4-43c4-aa4e-6778c121c8c9/scratchpad/aaa/harvest.tsv'

const PAGES = (process.env.HARVEST_PAGES ?? '/,/catalog').split(',')

test('harvest', async ({ page }) => {
  test.setTimeout(900_000)
  for (const path of PAGES) {
    const rows: string[] = []
    try {
      await page.goto(path, { timeout: 60_000 })
      await page.waitForTimeout(1500)
      const r = await new AxeBuilder({ page })
        .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag2aaa','wcag21aaa','wcag22aaa'])
        .analyze()
      for (const v of r.violations) {
        for (const n of v.nodes) {
          rows.push(`${path}\t${v.id}\t${n.target.join(' ')}\t${(n.failureSummary ?? '').replace(/\s+/g,' ')}\t${n.html.slice(0,200).replace(/\s+/g,' ')}`)
        }
      }
      for (const v of r.incomplete) rows.push(`${path}\tINCOMPLETE:${v.id}\t${v.nodes.length} nodes\t\t${v.nodes.map((n)=>n.target.join(' ')).slice(0,5).join(' | ')}`)
      rows.push(`${path}\tOK\t${r.violations.length} violation ids`)
    } catch (e) {
      rows.push(`${path}\tCRASH\t${String(e).slice(0, 200).replace(/\s+/g, ' ')}`)
    }
    fs.appendFileSync(OUT, rows.join('\n') + '\n')
  }
})
