import { describe, it, expect } from 'vitest'
import { loadApplicableParameters, resolveParameterDefs } from './catalog'
import { db } from '@/lib/db/client'
import { parameters, parameterProjects } from '@/lib/db/schema'
import {
  createUser,
  createCategory,
  createProduct,
  createProject,
  createCiSource,
  createEnvironment,
} from '@/test/helpers'

/*
 * #275 part 2. A global parameter can be narrowed to one or several projects.
 *
 * The precedence the owner chose is `product > category > project > global`,
 * which the existing scope rank already delivers — project narrowing is a
 * FILTER on top of a scope, not a fourth scope. What it adds is a tie-break
 * between two rows of the same scope where one names projects.
 */
const setup = async () => {
  const pm = await createUser({ role: 'project_manager' })
  const cat = await createCategory()
  const product = await createProduct(cat.id)
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  const mine = await createProject(pm.id, 'Webshop')
  const other = await createProject(pm.id, 'Billing')
  return { cat, product, env, mine, other }
}

const addParameter = async (over: Record<string, unknown>) => {
  const [row] = await db
    .insert(parameters)
    .values({ scope: 'global', scopeId: 0, name: 'region', type: 'string', ...over })
    .returning()
  return row
}

const narrowTo = async (parameterId: number, projectIds: number[]) => {
  await db.insert(parameterProjects).values(projectIds.map((projectId) => ({ parameterId, projectId })))
}

describe('parameters narrowed to projects (#275)', () => {
  it('applies to a project it names', async () => {
    const { cat, product, env, mine } = await setup()
    const param = await addParameter({ name: 'region' })
    await narrowTo(param.id, [mine.id])

    const rows = await loadApplicableParameters(product.id, cat.id, env.id, mine.id)

    expect(rows.map((r) => r.name)).toContain('region')
  })

  /*
   * The half that makes narrowing mean anything. Without it the table would be
   * decoration: every parameter would still apply everywhere.
   */
  it('does not apply to a project it does not name', async () => {
    const { cat, product, env, other, mine } = await setup()
    const param = await addParameter({ name: 'region' })
    await narrowTo(param.id, [mine.id])

    const rows = await loadApplicableParameters(product.id, cat.id, env.id, other.id)

    expect(rows.map((r) => r.name)).not.toContain('region')
  })

  it('applies everywhere when it names no projects at all', async () => {
    const { cat, product, env, other } = await setup()
    await addParameter({ name: 'region' })

    const rows = await loadApplicableParameters(product.id, cat.id, env.id, other.id)

    expect(rows.map((r) => r.name)).toContain('region')
  })

  /*
   * The catalogue renders the order form before a project is chosen. Filtering
   * to "unnarrowed only" there would hide a control the order will still
   * validate — and may require — once the project is picked.
   */
  it('hides nothing while the project is still unknown', async () => {
    const { cat, product, env, mine } = await setup()
    const param = await addParameter({ name: 'region' })
    await narrowTo(param.id, [mine.id])

    const rows = await loadApplicableParameters(product.id, cat.id, env.id)

    expect(rows.map((r) => r.name)).toContain('region')
  })

  it('applies to every project it names, not just the first', async () => {
    const { cat, product, env, mine, other } = await setup()
    const param = await addParameter({ name: 'region' })
    await narrowTo(param.id, [mine.id, other.id])

    for (const project of [mine, other]) {
      const rows = await loadApplicableParameters(product.id, cat.id, env.id, project.id)
      expect(rows.map((r) => r.name), `project ${project.id}`).toContain('region')
    }
  })

  describe('precedence', () => {
    /*
     * The tie-break narrowing adds: two global rows of the same name, one
     * narrowed to this project. The narrowed one is the more specific
     * statement, exactly as an environment-specific row is.
     */
    it('prefers the narrowed row over the one that applies everywhere', async () => {
      const { cat, product, env, mine } = await setup()
      await addParameter({ name: 'region', defaultValue: 'everywhere' })
      const narrow = await addParameter({ name: 'region', defaultValue: 'for-this-project' })
      await narrowTo(narrow.id, [mine.id])

      const defs = resolveParameterDefs(
        await loadApplicableParameters(product.id, cat.id, env.id, mine.id),
      )

      expect(defs.find((d) => d.name === 'region')?.defaultValue).toBe('for-this-project')
    })

    /*
     * The owner's decision, and the reason project is a filter rather than a
     * fourth scope: a product-scoped row beats a project-narrowed global one.
     * The product knows most precisely what it needs to provision.
     */
    it('lets the product win over a project-narrowed global', async () => {
      const { cat, product, env, mine } = await setup()
      const narrow = await addParameter({ name: 'region', defaultValue: 'from-project' })
      await narrowTo(narrow.id, [mine.id])
      await addParameter({
        scope: 'product', scopeId: product.id, name: 'region', defaultValue: 'from-product',
      })

      const defs = resolveParameterDefs(
        await loadApplicableParameters(product.id, cat.id, env.id, mine.id),
      )

      expect(defs.find((d) => d.name === 'region')?.defaultValue).toBe('from-product')
    })

    it('lets the category win over a project-narrowed global too', async () => {
      const { cat, product, env, mine } = await setup()
      const narrow = await addParameter({ name: 'region', defaultValue: 'from-project' })
      await narrowTo(narrow.id, [mine.id])
      await addParameter({
        scope: 'category', scopeId: cat.id, name: 'region', defaultValue: 'from-category',
      })

      const defs = resolveParameterDefs(
        await loadApplicableParameters(product.id, cat.id, env.id, mine.id),
      )

      expect(defs.find((d) => d.name === 'region')?.defaultValue).toBe('from-category')
    })
  })

  /*
   * `onDelete: 'cascade'` on both sides. A parameter narrowed to a project that
   * no longer exists would apply NOWHERE — silently, and the worst of the
   * available failures, because the parameter still looks configured.
   */
  it('stops being narrowed when the project it named is deleted', async () => {
    const { cat, product, env, mine, other } = await setup()
    const param = await addParameter({ name: 'region' })
    await narrowTo(param.id, [mine.id])

    await db.execute(`DELETE FROM projects WHERE id = ${mine.id}`)

    const rows = await loadApplicableParameters(product.id, cat.id, env.id, other.id)
    expect(rows.map((r) => r.name)).toContain('region')
  })
})
