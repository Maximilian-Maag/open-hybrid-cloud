import { z } from 'zod'
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { registry } from './registry'

extendZodWithOpenApi(z)

const bearerAuth = [{ BearerAuth: [] }]

// ─── Shared schemas ───────────────────────────────────────────────────────────

const userSchema = z.object({
  id: z.number(),
  email: z.string(),
  name: z.string().nullable(),
  role: z.string(),
  active: z.boolean(),
  ssoSub: z.string().nullable(),
  createdAt: z.string().nullable(),
})

const orderSchema = z.object({
  id: z.number(),
  projectId: z.number(),
  productId: z.number(),
  environmentId: z.number(),
  userId: z.number(),
  status: z.string(),
  parameters: z.record(z.string()).nullable(),
  costCenterId: z.number().nullable(),
  rejectionNote: z.string().nullable(),
  pipelineId: z.array(z.string()).nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  productName: z.string().nullable(),
  environmentName: z.string().nullable(),
  userName: z.string().nullable(),
})

const projectSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  ownerId: z.number(),
  costCenterId: z.number().nullable(),
  createdAt: z.string().nullable(),
  ownerName: z.string().nullable(),
  costCenterName: z.string().nullable(),
})

const categorySchema = z.object({
  id: z.number(),
  name: z.string(),
  displayOrder: z.number(),
})

const productSchema = z.object({
  id: z.number(),
  categoryId: z.number(),
  baseLanguage: z.string(),
  createdAt: z.string().nullable(),
  name: z.string().nullable(),
  description: z.string().nullable(),
})

const parameterSchema = z.object({
  id: z.number(),
  scope: z.string(),
  scopeId: z.number(),
  environmentId: z.number().nullable(),
  name: z.string(),
  type: z.string(),
  description: z.string(),
  defaultValue: z.string(),
  required: z.boolean(),
  sensitive: z.boolean(),
})

const environmentSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  ciSourceId: z.number(),
  webhookUrl: z.string(),
  webhookToken: z.string(),
})

const costCenterSchema = z.object({
  id: z.number(),
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
})

const ciSourceSchema = z.object({
  id: z.number(),
  name: z.string(),
  url: z.string(),
  provider: z.string(),
})

const infraSchema = z.object({
  id: z.number(),
  orderId: z.number(),
  projectId: z.number(),
  environmentId: z.number(),
  productId: z.number(),
  status: z.string(),
  parameters: z.record(z.string()).nullable(),
  pipelineId: z.array(z.string()).nullable(),
  outputs: z.record(z.string()).nullable(),
  deployedAt: z.string().nullable(),
  productName: z.string().nullable(),
  environmentName: z.string().nullable(),
  projectName: z.string().nullable(),
})

const auditEntrySchema = z.object({
  id: z.number(),
  userId: z.number().nullable(),
  action: z.string().nullable(),
  entityId: z.number().nullable(),
  details: z.string().nullable(),
  createdAt: z.string().nullable(),
  userName: z.string().nullable(),
})

const webhookSchema = z.object({
  id: z.number(),
  productId: z.number(),
  environmentId: z.number(),
  name: z.string(),
  webhookUrl: z.string(),
  webhookToken: z.string(),
  execOrder: z.number(),
})

const productEnvironmentSchema = z.object({
  productId: z.number(),
  environmentId: z.number(),
  price: z.string(),
  currency: z.string(),
  costCenterMode: z.string(),
  forcedCostCenter: z.boolean(),
  environmentName: z.string().nullable(),
})

const exchangeRateSchema = z.object({
  id: z.number(),
  currencyCode: z.string(),
  rateToEur: z.string(),
  updatedAt: z.string().nullable(),
})

// ─── System ───────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/health',
  summary: 'Health check',
  tags: ['System'],
  security: [],
  responses: {
    200: {
      description: 'Service is healthy',
      content: { 'application/json': { schema: z.object({ status: z.string() }) } },
    },
  },
})

registry.registerPath({
  method: 'get',
  path: '/docs',
  summary: 'Swagger UI',
  tags: ['System'],
  security: [],
  responses: {
    200: { description: 'HTML page with Swagger UI' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/docs/spec',
  summary: 'OpenAPI specification (JSON)',
  tags: ['System'],
  security: [],
  responses: {
    200: { description: 'OpenAPI JSON document' },
  },
})

// ─── Auth ─────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/auth/login',
  summary: 'Login with email and password',
  tags: ['Auth'],
  security: [],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            email: z.string().email(),
            password: z.string().min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'JWT token and user info',
      content: {
        'application/json': {
          schema: z.object({
            token: z.string(),
            user: z.object({
              id: z.number(),
              email: z.string(),
              name: z.string().nullable(),
              role: z.string(),
            }),
          }),
        },
      },
    },
    400: { description: 'Bad request' },
    401: { description: 'Invalid credentials' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/auth/callback',
  summary: 'OIDC / Entra ID callback — exchanges code for JWT and redirects',
  tags: ['Auth'],
  security: [],
  request: {
    query: z.object({ code: z.string() }),
  },
  responses: {
    302: { description: 'Redirect to frontend with JWT token' },
    400: { description: 'Missing or invalid code / claims' },
    500: { description: 'Entra ID not configured' },
    502: { description: 'Token exchange failed' },
  },
})

// ─── Catalog ──────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/catalog',
  summary: 'List catalog products',
  tags: ['Catalog'],
  security: bearerAuth,
  request: {
    query: z.object({
      lang: z.string().optional(),
      search: z.string().optional(),
      categoryId: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of products',
      content: { 'application/json': { schema: z.array(productSchema) } },
    },
    401: { description: 'Unauthorized' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/catalog/{id}',
  summary: 'Get catalog product detail with environments and parameters',
  tags: ['Catalog'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({
      lang: z.string().optional(),
      environmentId: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Product with environments and parameters',
      content: {
        'application/json': {
          schema: productSchema.extend({
            environments: z.array(productEnvironmentSchema),
            parameters: z.array(parameterSchema),
          }),
        },
      },
    },
    401: { description: 'Unauthorized' },
    404: { description: 'Product not found' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/catalog/{id}/image',
  summary: 'Get catalog product image (binary)',
  tags: ['Catalog'],
  security: [],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'PNG image',
      content: { 'image/png': { schema: z.any() } },
    },
    404: { description: 'Image not found' },
  },
})

// ─── Orders ───────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/orders',
  summary: 'List orders (admins see all, project managers see own)',
  tags: ['Orders'],
  security: bearerAuth,
  responses: {
    200: {
      description: 'List of orders',
      content: { 'application/json': { schema: z.array(orderSchema) } },
    },
    401: { description: 'Unauthorized' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/orders',
  summary: 'Create a new order',
  tags: ['Orders'],
  security: bearerAuth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            projectId: z.number().int().positive(),
            productId: z.number().int().positive(),
            environmentId: z.number().int().positive(),
            costCenterId: z.number().int().positive().optional(),
            parameters: z.record(z.string()),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Order created',
      content: { 'application/json': { schema: orderSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/orders/{id}',
  summary: 'Get order by ID',
  tags: ['Orders'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'Order',
      content: { 'application/json': { schema: orderSchema } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Order not found' },
  },
})

// ─── Approvals ────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/approvals',
  summary: '[admin] List pending orders awaiting approval',
  tags: ['Approvals'],
  security: bearerAuth,
  responses: {
    200: {
      description: 'List of pending orders',
      content: {
        'application/json': {
          schema: z.array(
            orderSchema.extend({ projectName: z.string().nullable() }),
          ),
        },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/approvals/{id}/approve',
  summary: '[admin] Approve an order and trigger provisioning',
  tags: ['Approvals'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'Order approved',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            infraId: z.number(),
            pipelineIds: z.array(z.string()),
          }),
        },
      },
    },
    400: { description: 'Order is not pending' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Order not found' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/approvals/{id}/reject',
  summary: '[admin] Reject an order',
  tags: ['Approvals'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({ rejectionNote: z.string().min(1) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Order rejected',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Order not found' },
  },
})

// ─── Projects ─────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/projects',
  summary: 'List projects (admins see all, project managers see own)',
  tags: ['Projects'],
  security: bearerAuth,
  responses: {
    200: {
      description: 'List of projects',
      content: { 'application/json': { schema: z.array(projectSchema) } },
    },
    401: { description: 'Unauthorized' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/projects',
  summary: 'Create a project',
  tags: ['Projects'],
  security: bearerAuth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1),
            description: z.string().optional(),
            costCenterId: z.number().int().positive().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Project created',
      content: { 'application/json': { schema: projectSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/projects/{id}',
  summary: 'Get project by ID',
  tags: ['Projects'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'Project',
      content: { 'application/json': { schema: projectSchema } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Project not found' },
  },
})

registry.registerPath({
  method: 'put',
  path: '/projects/{id}',
  summary: 'Update a project',
  tags: ['Projects'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).optional(),
            description: z.string().optional(),
            costCenterId: z.number().int().positive().nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated project',
      content: { 'application/json': { schema: projectSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Project not found' },
  },
})

registry.registerPath({
  method: 'delete',
  path: '/projects/{id}',
  summary: '[admin] Delete a project',
  tags: ['Projects'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'Project deleted',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Project not found' },
  },
})

// ─── Infrastructure ───────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/infrastructure',
  summary: 'List infrastructure elements',
  tags: ['Infrastructure'],
  security: bearerAuth,
  request: {
    query: z.object({
      productId: z.string().optional(),
      projectId: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of infrastructure elements',
      content: { 'application/json': { schema: z.array(infraSchema) } },
    },
    401: { description: 'Unauthorized' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/infrastructure/{id}/decommission',
  summary: 'Decommission an infrastructure element',
  tags: ['Infrastructure'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'Decommissioning initiated',
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean(), pipelineIds: z.array(z.string()) }),
        },
      },
    },
    400: { description: 'Infrastructure element is not active' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Infrastructure element not found' },
  },
})

// ─── Users ────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/users/me',
  summary: 'Get current user profile',
  tags: ['Users'],
  security: bearerAuth,
  responses: {
    200: {
      description: 'Current user',
      content: { 'application/json': { schema: userSchema } },
    },
    401: { description: 'Unauthorized' },
    404: { description: 'User not found' },
  },
})

registry.registerPath({
  method: 'put',
  path: '/users/me',
  summary: 'Update current user display name',
  tags: ['Users'],
  security: bearerAuth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ name: z.string().min(1) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated user',
      content: { 'application/json': { schema: userSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
  },
})

registry.registerPath({
  method: 'put',
  path: '/users/me/password',
  summary: 'Change current user password',
  tags: ['Users'],
  security: bearerAuth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            currentPassword: z.string().min(1),
            newPassword: z.string().min(8),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Password changed',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    400: { description: 'Bad request or wrong current password' },
    401: { description: 'Unauthorized' },
  },
})

// ─── Audit ────────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/audit',
  summary: '[admin] List audit log entries with pagination',
  tags: ['Audit'],
  security: bearerAuth,
  request: {
    query: z.object({
      userId: z.string().optional(),
      action: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      page: z.string().optional(),
      pageSize: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Paginated audit log',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(auditEntrySchema),
            total: z.number(),
            page: z.number(),
            pageSize: z.number(),
          }),
        },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/audit/export',
  summary: '[admin] Export audit log as CSV or PDF',
  tags: ['Audit'],
  security: bearerAuth,
  request: {
    query: z.object({
      userId: z.string().optional(),
      action: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      format: z.enum(['csv', 'pdf']).optional(),
    }),
  },
  responses: {
    200: {
      description: 'CSV or PDF file',
      content: {
        'text/csv': { schema: z.any() },
        'application/pdf': { schema: z.any() },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

// ─── Webhooks (public) ────────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/webhooks/gitlab/pipeline',
  summary: 'GitLab pipeline webhook receiver',
  tags: ['Webhooks'],
  security: [],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            object_kind: z.string(),
            object_attributes: z.object({
              id: z.number(),
              status: z.string(),
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Event received',
      content: { 'application/json': { schema: z.object({ received: z.boolean() }) } },
    },
    400: { description: 'Invalid payload' },
    401: { description: 'Invalid token' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/webhooks/github/workflow',
  summary: 'GitHub Actions workflow webhook receiver',
  tags: ['Webhooks'],
  security: [],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            action: z.string(),
            workflow_run: z.object({
              id: z.number(),
              name: z.string(),
              status: z.string(),
              conclusion: z.string().nullable(),
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Event received',
      content: { 'application/json': { schema: z.object({ received: z.boolean() }) } },
    },
    400: { description: 'Invalid JSON' },
    401: { description: 'Invalid signature' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/webhooks/bitbucket/pipeline',
  summary: 'Bitbucket pipeline webhook receiver',
  tags: ['Webhooks'],
  security: [],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            data: z.object({
              uuid: z.string(),
              state: z.object({
                name: z.string(),
                result: z.object({ name: z.string() }).optional(),
              }),
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Event received',
      content: { 'application/json': { schema: z.object({ received: z.boolean() }) } },
    },
    400: { description: 'Invalid JSON' },
    401: { description: 'Invalid signature' },
  },
})

// ─── Admin — Categories ───────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/admin/categories',
  summary: '[root] List categories',
  tags: ['Admin'],
  security: bearerAuth,
  responses: {
    200: {
      description: 'List of categories',
      content: { 'application/json': { schema: z.array(categorySchema) } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/admin/categories',
  summary: '[root] Create a category',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1),
            displayOrder: z.number().int().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Category created',
      content: { 'application/json': { schema: categorySchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/admin/categories/{id}',
  summary: '[root] Get category by ID',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'Category',
      content: { 'application/json': { schema: categorySchema } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

registry.registerPath({
  method: 'put',
  path: '/admin/categories/{id}',
  summary: '[root] Update a category',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).optional(),
            displayOrder: z.number().int().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated category',
      content: { 'application/json': { schema: categorySchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

registry.registerPath({
  method: 'delete',
  path: '/admin/categories/{id}',
  summary: '[root] Delete a category',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'Category deleted',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

// ─── Admin — Products ─────────────────────────────────────────────────────────

const adminProductSchema = productSchema.extend({
  categoryName: z.string().nullable(),
})

registry.registerPath({
  method: 'get',
  path: '/admin/products',
  summary: '[root] List all products',
  tags: ['Admin'],
  security: bearerAuth,
  responses: {
    200: {
      description: 'List of products',
      content: { 'application/json': { schema: z.array(adminProductSchema) } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/admin/products',
  summary: '[root] Create a product',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            categoryId: z.number().int().positive(),
            baseLanguage: z.string().optional(),
            name: z.string().min(1),
            description: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Product created',
      content: { 'application/json': { schema: adminProductSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/admin/products/{id}',
  summary: '[root] Get product by ID',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'Product',
      content: { 'application/json': { schema: adminProductSchema } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

registry.registerPath({
  method: 'put',
  path: '/admin/products/{id}',
  summary: '[root] Update a product',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            categoryId: z.number().int().positive().optional(),
            baseLanguage: z.string().optional(),
            name: z.string().min(1).optional(),
            description: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated product',
      content: { 'application/json': { schema: productSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

registry.registerPath({
  method: 'delete',
  path: '/admin/products/{id}',
  summary: '[root] Delete a product',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'Product deleted',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/admin/products/{id}/translations',
  summary: '[root] Get all translations for a product',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'List of translations',
      content: {
        'application/json': {
          schema: z.array(
            z.object({
              productId: z.number(),
              languageCode: z.string(),
              name: z.string(),
              description: z.string(),
            }),
          ),
        },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'put',
  path: '/admin/products/{id}/translations/{lang}',
  summary: '[root] Upsert a product translation',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string(), lang: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1),
            description: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Upserted translation',
      content: {
        'application/json': {
          schema: z.object({
            productId: z.number(),
            languageCode: z.string(),
            name: z.string(),
            description: z.string(),
          }),
        },
      },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/admin/products/{id}/translate',
  summary: '[root] Auto-translate product using AI',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'Translation result',
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean(), languages: z.array(z.string()) }),
        },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Product or base translation not found' },
  },
})

registry.registerPath({
  method: 'put',
  path: '/admin/products/{id}/image',
  summary: '[root] Upload product image (multipart)',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({ image: z.any() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Image uploaded',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    400: { description: 'No image provided' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/admin/products/{id}/environments',
  summary: '[root] Get product-environment associations',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'List of product environments',
      content: { 'application/json': { schema: z.array(productEnvironmentSchema) } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/admin/products/{id}/environments',
  summary: '[root] Add or update a product-environment association',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            environmentId: z.number().int().positive(),
            price: z.string().optional(),
            currency: z.string().optional(),
            costCenterMode: z.enum(['project', 'select', 'overhead']).optional(),
            forcedCostCenter: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Product environment created / updated',
      content: { 'application/json': { schema: productEnvironmentSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'put',
  path: '/admin/products/{id}/environments/{envId}',
  summary: '[root] Update a product-environment association',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string(), envId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            price: z.string().optional(),
            currency: z.string().optional(),
            costCenterMode: z.enum(['project', 'select', 'overhead']).optional(),
            forcedCostCenter: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated product environment',
      content: { 'application/json': { schema: productEnvironmentSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

registry.registerPath({
  method: 'delete',
  path: '/admin/products/{id}/environments/{envId}',
  summary: '[root] Remove a product-environment association',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string(), envId: z.string() }),
  },
  responses: {
    200: {
      description: 'Association deleted',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/admin/products/{id}/webhooks',
  summary: '[root] List webhooks for a product',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'List of webhooks',
      content: { 'application/json': { schema: z.array(webhookSchema) } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/admin/products/{id}/webhooks',
  summary: '[root] Add a webhook to a product',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            environmentId: z.number().int().positive(),
            name: z.string().min(1),
            webhookUrl: z.string().url(),
            webhookToken: z.string().min(1),
            execOrder: z.number().int().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Webhook created',
      content: { 'application/json': { schema: webhookSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'put',
  path: '/admin/products/{id}/webhooks/{whId}',
  summary: '[root] Update a product webhook',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string(), whId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            environmentId: z.number().int().positive().optional(),
            name: z.string().min(1).optional(),
            webhookUrl: z.string().url().optional(),
            webhookToken: z.string().min(1).optional(),
            execOrder: z.number().int().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated webhook',
      content: { 'application/json': { schema: webhookSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

registry.registerPath({
  method: 'delete',
  path: '/admin/products/{id}/webhooks/{whId}',
  summary: '[root] Delete a product webhook',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string(), whId: z.string() }),
  },
  responses: {
    200: {
      description: 'Webhook deleted',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

// ─── Admin — Parameters ───────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/admin/parameters',
  summary: '[admin] List parameters',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    query: z.object({
      scope: z.enum(['global', 'category', 'product']).optional(),
      scopeId: z.string().optional(),
      environmentId: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of parameters',
      content: { 'application/json': { schema: z.array(parameterSchema) } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/admin/parameters',
  summary: '[admin] Create a parameter',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            scope: z.enum(['global', 'category', 'product']),
            scopeId: z.number().int().optional(),
            environmentId: z.number().int().positive().nullable().optional(),
            name: z.string().min(1),
            type: z.enum(['string', 'number', 'bool', 'dropdown']),
            description: z.string().optional(),
            defaultValue: z.string().optional(),
            required: z.boolean().optional(),
            sensitive: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Parameter created',
      content: { 'application/json': { schema: parameterSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'put',
  path: '/admin/parameters/{id}',
  summary: '[admin] Update a parameter',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).optional(),
            type: z.enum(['string', 'number', 'bool', 'dropdown']).optional(),
            description: z.string().optional(),
            defaultValue: z.string().optional(),
            required: z.boolean().optional(),
            sensitive: z.boolean().optional(),
            environmentId: z.number().int().positive().nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated parameter',
      content: { 'application/json': { schema: parameterSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

registry.registerPath({
  method: 'delete',
  path: '/admin/parameters/{id}',
  summary: '[admin] Delete a parameter',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'Parameter deleted',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

// ─── Admin — CI Sources ───────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/admin/ci-sources',
  summary: '[root] List CI sources',
  tags: ['Admin'],
  security: bearerAuth,
  responses: {
    200: {
      description: 'List of CI sources',
      content: { 'application/json': { schema: z.array(ciSourceSchema) } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/admin/ci-sources',
  summary: '[root] Create a CI source',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1),
            url: z.string().url(),
            accessToken: z.string().min(1),
            provider: z.enum(['gitlab', 'github', 'bitbucket']),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'CI source created',
      content: { 'application/json': { schema: ciSourceSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/admin/ci-sources/{id}',
  summary: '[root] Get CI source by ID',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'CI source',
      content: { 'application/json': { schema: ciSourceSchema } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

registry.registerPath({
  method: 'put',
  path: '/admin/ci-sources/{id}',
  summary: '[root] Update a CI source',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).optional(),
            url: z.string().url().optional(),
            accessToken: z.string().min(1).optional(),
            provider: z.enum(['gitlab', 'github', 'bitbucket']).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated CI source',
      content: { 'application/json': { schema: ciSourceSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

registry.registerPath({
  method: 'delete',
  path: '/admin/ci-sources/{id}',
  summary: '[root] Delete a CI source',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'CI source deleted',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

// ─── Admin — CI Browser ───────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/admin/ci/{sourceId}/projects',
  summary: '[root] List projects in a CI source',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ sourceId: z.string() }),
    query: z.object({ search: z.string().optional() }),
  },
  responses: {
    200: {
      description: 'List of CI projects',
      content: {
        'application/json': {
          schema: z.array(z.object({ id: z.string(), name: z.string(), url: z.string().optional() })),
        },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'CI source not found' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/admin/ci/{sourceId}/projects/{projectId}/branches',
  summary: '[root] List branches of a CI project',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ sourceId: z.string(), projectId: z.string() }),
  },
  responses: {
    200: {
      description: 'List of branches',
      content: {
        'application/json': {
          schema: z.array(z.object({ name: z.string() })),
        },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'CI source not found' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/admin/ci/{sourceId}/projects/{projectId}/files',
  summary: '[root] List files in a CI project repository',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ sourceId: z.string(), projectId: z.string() }),
    query: z.object({
      branch: z.string().optional(),
      path: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of files',
      content: {
        'application/json': {
          schema: z.array(z.object({ name: z.string(), path: z.string(), type: z.string() })),
        },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'CI source not found' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/admin/ci/{sourceId}/projects/{projectId}/import-vars',
  summary: '[root] Import Terraform variables from a file in a CI project',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ sourceId: z.string(), projectId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            branch: z.string().min(1),
            filePath: z.string().min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Parsed Terraform variables',
      content: {
        'application/json': {
          schema: z.array(
            z.object({
              name: z.string(),
              type: z.string(),
              description: z.string().optional(),
              default: z.string().optional(),
            }),
          ),
        },
      },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'CI source not found' },
  },
})

// ─── Admin — Environments ─────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/admin/environments',
  summary: '[admin] List deployment environments',
  tags: ['Admin'],
  security: bearerAuth,
  responses: {
    200: {
      description: 'List of environments',
      content: {
        'application/json': {
          schema: z.array(
            environmentSchema.extend({ ciSourceName: z.string().nullable() }),
          ),
        },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/admin/environments',
  summary: '[admin] Create a deployment environment',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1),
            description: z.string().optional(),
            ciSourceId: z.number().int().positive(),
            webhookUrl: z.string().url(),
            webhookToken: z.string().min(1),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Environment created',
      content: { 'application/json': { schema: environmentSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/admin/environments/{id}',
  summary: '[admin] Get deployment environment by ID',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'Environment',
      content: { 'application/json': { schema: environmentSchema } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

registry.registerPath({
  method: 'put',
  path: '/admin/environments/{id}',
  summary: '[admin] Update a deployment environment',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).optional(),
            description: z.string().optional(),
            ciSourceId: z.number().int().positive().optional(),
            webhookUrl: z.string().url().optional(),
            webhookToken: z.string().min(1).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated environment',
      content: { 'application/json': { schema: environmentSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

registry.registerPath({
  method: 'delete',
  path: '/admin/environments/{id}',
  summary: '[admin] Delete a deployment environment',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'Environment deleted',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

// ─── Admin — Cost Centers ─────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/admin/cost-centers',
  summary: '[admin] List cost centers',
  tags: ['Admin'],
  security: bearerAuth,
  responses: {
    200: {
      description: 'List of cost centers',
      content: { 'application/json': { schema: z.array(costCenterSchema) } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/admin/cost-centers',
  summary: '[admin] Create a cost center',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            code: z.string().min(1),
            name: z.string().min(1),
            active: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Cost center created',
      content: { 'application/json': { schema: costCenterSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/admin/cost-centers/{id}',
  summary: '[admin] Get cost center by ID',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'Cost center',
      content: { 'application/json': { schema: costCenterSchema } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

registry.registerPath({
  method: 'put',
  path: '/admin/cost-centers/{id}',
  summary: '[admin] Update a cost center',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            code: z.string().min(1).optional(),
            name: z.string().min(1).optional(),
            active: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated cost center',
      content: { 'application/json': { schema: costCenterSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

registry.registerPath({
  method: 'delete',
  path: '/admin/cost-centers/{id}',
  summary: '[admin] Delete a cost center',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'Cost center deleted',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

// ─── Admin — Users ────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/admin/users',
  summary: '[root] List all users',
  tags: ['Admin'],
  security: bearerAuth,
  responses: {
    200: {
      description: 'List of users',
      content: { 'application/json': { schema: z.array(userSchema) } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/admin/users',
  summary: '[root] Create a user',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            email: z.string().email(),
            name: z.string().min(1),
            role: z.enum(['admin', 'project_manager', 'root']),
            password: z.string().min(8),
            active: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'User created',
      content: { 'application/json': { schema: userSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/admin/users/{id}',
  summary: '[root] Get user by ID',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'User',
      content: { 'application/json': { schema: userSchema } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

registry.registerPath({
  method: 'put',
  path: '/admin/users/{id}',
  summary: '[root] Update a user',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).optional(),
            role: z.enum(['admin', 'project_manager', 'root']).optional(),
            active: z.boolean().optional(),
            password: z.string().min(8).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated user',
      content: { 'application/json': { schema: userSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

registry.registerPath({
  method: 'delete',
  path: '/admin/users/{id}',
  summary: '[root] Delete a user',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'User deleted',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    400: { description: 'Cannot delete own account' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
  },
})

// ─── Admin — Config: SMTP ─────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/admin/config/smtp',
  summary: '[root] Get SMTP configuration',
  tags: ['Admin'],
  security: bearerAuth,
  responses: {
    200: {
      description: 'SMTP config (password never returned)',
      content: {
        'application/json': {
          schema: z.object({
            smtpHost: z.string().nullable(),
            smtpPort: z.number().nullable(),
            smtpFrom: z.string().nullable(),
            smtpUser: z.string().nullable(),
            smtpTls: z.boolean(),
          }),
        },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'put',
  path: '/admin/config/smtp',
  summary: '[root] Update SMTP configuration',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            host: z.string().min(1),
            port: z.number().int().positive(),
            from: z.string().min(1),
            user: z.string().optional(),
            password: z.string().optional(),
            tls: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'SMTP config updated',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

// ─── Admin — Config: AI ───────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/admin/config/ai',
  summary: '[root] Get AI configuration',
  tags: ['Admin'],
  security: bearerAuth,
  responses: {
    200: {
      description: 'AI config (API key never returned)',
      content: {
        'application/json': {
          schema: z.object({
            aiProvider: z.string().nullable(),
            aiEndpoint: z.string().nullable(),
            aiModel: z.string().nullable(),
          }),
        },
      },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'put',
  path: '/admin/config/ai',
  summary: '[root] Update AI configuration',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            provider: z.enum(['claude', 'openai', 'azure_openai', 'ollama', 'localai']),
            endpoint: z.string().min(1),
            apiKey: z.string().optional(),
            model: z.string().min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'AI config updated',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

// ─── Admin — Branding ─────────────────────────────────────────────────────────

const brandingSchema = z.object({
  id: z.number().optional(),
  primaryColor: z.string().nullable(),
  secondaryColor: z.string().nullable(),
  shopName: z.string().nullable(),
  shopSubtitle: z.string().nullable(),
  imprintText: z.string().nullable(),
  logoMime: z.string().nullable(),
})

registry.registerPath({
  method: 'get',
  path: '/admin/branding',
  summary: '[root] Get branding settings',
  tags: ['Admin'],
  security: bearerAuth,
  responses: {
    200: {
      description: 'Branding settings',
      content: { 'application/json': { schema: brandingSchema } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'put',
  path: '/admin/branding',
  summary: '[root] Update branding settings',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            primaryColor: z.string().optional(),
            secondaryColor: z.string().optional(),
            shopName: z.string().optional(),
            shopSubtitle: z.string().optional(),
            imprintText: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated branding',
      content: { 'application/json': { schema: brandingSchema } },
    },
    400: { description: 'Bad request' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/admin/branding/logo',
  summary: 'Get branding logo (binary)',
  tags: ['Admin'],
  security: [],
  responses: {
    200: {
      description: 'Logo image',
      content: { 'image/*': { schema: z.any() } },
    },
    404: { description: 'No logo set' },
  },
})

registry.registerPath({
  method: 'put',
  path: '/admin/branding/logo',
  summary: '[root] Upload branding logo (multipart)',
  tags: ['Admin'],
  security: bearerAuth,
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({ logo: z.any() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Logo uploaded',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    400: { description: 'No logo provided' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})

// ─── Admin — Exchange Rates ───────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/admin/exchange-rates',
  summary: 'List exchange rates',
  tags: ['Admin'],
  security: bearerAuth,
  responses: {
    200: {
      description: 'List of exchange rates',
      content: { 'application/json': { schema: z.array(exchangeRateSchema) } },
    },
    401: { description: 'Unauthorized' },
  },
})

registry.registerPath({
  method: 'post',
  path: '/admin/exchange-rates/refresh',
  summary: '[root] Refresh exchange rates from external source',
  tags: ['Admin'],
  security: bearerAuth,
  responses: {
    200: {
      description: 'Updated exchange rates',
      content: { 'application/json': { schema: z.array(exchangeRateSchema) } },
    },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
})
