import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'

export const registry = new OpenAPIRegistry()

registry.registerComponent('securitySchemes', 'BearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'JWT token issued by POST /api/auth/login',
})

export const generateOpenApiDocument = () => {
  const generator = new OpenApiGeneratorV3(registry.definitions)

  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Open Hybrid Cloud API',
      version: '1.0.0',
      description:
        'Self-service IT infrastructure portal API. Three roles: root (webshop admin), admin (IT admin), project_manager (end user).',
    },
    servers: [{ url: '/api', description: 'API base path' }],
    security: [{ BearerAuth: [] }],
  })
}
