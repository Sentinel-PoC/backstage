/**
 * OPS-371 — MCP Actions Registry: catalog and scaffolder action modules.
 *
 * Three modules, each using pluginId 'mcp-actions' so they share the
 * plugin-scoped actionsRegistryService with @backstage/plugin-mcp-actions-backend.
 *
 * Registered actions:
 *   - catalog:entity-get          — fetch one entity by kind/namespace/name
 *   - catalog:entities-search     — list/filter entities by catalog filter syntax
 *   - scaffolder:templates-list   — list all Template entities
 */

import { createBackendModule, coreServices } from '@backstage/backend-plugin-api';
import { actionsRegistryServiceRef } from '@backstage/backend-plugin-api/alpha';

// ---------------------------------------------------------------------------
// catalog:entity-get
// ---------------------------------------------------------------------------

/**
 * MCP action: fetch a single catalog entity by kind / namespace / name.
 * Uses the catalog REST API: GET /entities/by-name/{kind}/{namespace}/{name}
 */
export const catalogEntityGetModule = createBackendModule({
  pluginId: 'mcp-actions',
  moduleId: 'catalog-entity-get',
  register(reg) {
    reg.registerInit({
      deps: {
        actionsRegistry: actionsRegistryServiceRef,
        discovery: coreServices.discovery,
        auth: coreServices.auth,
      },
      async init({ actionsRegistry, discovery, auth }) {
        actionsRegistry.register({
          name: 'catalog:entity-get',
          title: 'Get Catalog Entity',
          description:
            'Fetch a single Backstage catalog entity by kind, namespace, and name.',
          schema: {
            input: z =>
              z.object({
                kind: z
                  .string()
                  .describe('Entity kind, e.g. Component, API, User, Group'),
                namespace: z
                  .string()
                  .default('default')
                  .describe('Entity namespace (default: "default")'),
                name: z.string().describe('Entity name'),
              }),
            output: z =>
              z.object({
                entity: z
                  .any()
                  .describe('The catalog entity object, or null if not found'),
              }),
          },
          attributes: { readOnly: true, destructive: false, idempotent: true },
          async action({ input, logger, credentials }) {
            const baseUrl = await discovery.getBaseUrl('catalog');
            const { token } = await auth.getPluginRequestToken({
              onBehalfOf: credentials,
              targetPluginId: 'catalog',
            });
            const { kind, namespace, name } = input;
            const url =
              `${baseUrl}/entities/by-name/` +
              `${encodeURIComponent(kind)}/` +
              `${encodeURIComponent(namespace)}/` +
              `${encodeURIComponent(name)}`;
            logger.info(`[catalog:entity-get] GET ${url}`);
            const res = await fetch(url, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (res.status === 404) {
              return { output: { entity: null } };
            }
            if (!res.ok) {
              throw new Error(
                `Catalog returned HTTP ${res.status}: ${await res.text()}`,
              );
            }
            return { output: { entity: await res.json() } };
          },
        });
      },
    });
  },
});

// ---------------------------------------------------------------------------
// catalog:entities-search
// ---------------------------------------------------------------------------

/**
 * MCP action: list / search catalog entities using catalog filter syntax.
 * Uses the catalog REST API: GET /entities?filter=<expr>&limit=<n>
 *
 * Filter examples:
 *   "kind=Component"
 *   "kind=Component,spec.type=service"   (comma → multiple filter params → AND)
 *   "metadata.namespace=default"
 */
export const catalogEntitiesSearchModule = createBackendModule({
  pluginId: 'mcp-actions',
  moduleId: 'catalog-entities-search',
  register(reg) {
    reg.registerInit({
      deps: {
        actionsRegistry: actionsRegistryServiceRef,
        discovery: coreServices.discovery,
        auth: coreServices.auth,
      },
      async init({ actionsRegistry, discovery, auth }) {
        actionsRegistry.register({
          name: 'catalog:entities-search',
          title: 'Search Catalog Entities',
          description:
            'Search Backstage catalog entities using catalog filter syntax. ' +
            'Filter examples: "kind=Component", "kind=API,spec.type=openapi". ' +
            'Comma-separated fields are AND-ed. Omit filter to list all entities.',
          schema: {
            input: z =>
              z.object({
                filter: z
                  .string()
                  .optional()
                  .describe(
                    'Catalog filter expression (comma-separated field=value pairs). ' +
                    'Example: "kind=Component,spec.type=service"',
                  ),
                limit: z
                  .number()
                  .int()
                  .min(1)
                  .max(100)
                  .default(20)
                  .describe('Maximum number of results to return (1–100, default 20)'),
              }),
            output: z =>
              z.object({
                entities: z
                  .array(z.any())
                  .describe('List of matching catalog entities'),
                total: z
                  .number()
                  .int()
                  .describe('Number of entities returned'),
              }),
          },
          attributes: { readOnly: true, destructive: false, idempotent: true },
          async action({ input, logger, credentials }) {
            const baseUrl = await discovery.getBaseUrl('catalog');
            const { token } = await auth.getPluginRequestToken({
              onBehalfOf: credentials,
              targetPluginId: 'catalog',
            });
            const params = new URLSearchParams();
            if (input.filter) {
              // Catalog API accepts repeated "filter" params for AND-semantics;
              // split on comma to allow multi-field expressions in a single string.
              for (const f of input.filter.split(',')) {
                params.append('filter', f.trim());
              }
            }
            params.set('limit', String(input.limit ?? 20));
            const url = `${baseUrl}/entities?${params.toString()}`;
            logger.info(`[catalog:entities-search] GET ${url}`);
            const res = await fetch(url, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
              throw new Error(
                `Catalog returned HTTP ${res.status}: ${await res.text()}`,
              );
            }
            const entities: unknown[] = await res.json();
            return {
              output: {
                entities,
                total: Array.isArray(entities) ? entities.length : 0,
              },
            };
          },
        });
      },
    });
  },
});

// ---------------------------------------------------------------------------
// scaffolder:templates-list
// ---------------------------------------------------------------------------

/**
 * MCP action: list all scaffolder templates (kind=Template) from the catalog.
 * Returns condensed metadata (name, namespace, title, description).
 */
export const scaffolderTemplatesListModule = createBackendModule({
  pluginId: 'mcp-actions',
  moduleId: 'scaffolder-templates-list',
  register(reg) {
    reg.registerInit({
      deps: {
        actionsRegistry: actionsRegistryServiceRef,
        discovery: coreServices.discovery,
        auth: coreServices.auth,
      },
      async init({ actionsRegistry, discovery, auth }) {
        actionsRegistry.register({
          name: 'scaffolder:templates-list',
          title: 'List Scaffolder Templates',
          description:
            'List all Backstage scaffolder templates (kind=Template) available in the catalog.',
          schema: {
            input: z =>
              z.object({
                namespace: z
                  .string()
                  .optional()
                  .describe(
                    'Filter templates to this namespace. Omit to list templates from all namespaces.',
                  ),
              }),
            output: z =>
              z.object({
                templates: z
                  .array(
                    z.object({
                      name: z.string().describe('Template name'),
                      namespace: z.string().describe('Template namespace'),
                      title: z
                        .string()
                        .optional()
                        .describe('Human-readable title'),
                      description: z
                        .string()
                        .optional()
                        .describe('Template description'),
                    }),
                  )
                  .describe('List of template metadata objects'),
                total: z
                  .number()
                  .int()
                  .describe('Number of templates found'),
              }),
          },
          attributes: { readOnly: true, destructive: false, idempotent: true },
          async action({ input, logger, credentials }) {
            const baseUrl = await discovery.getBaseUrl('catalog');
            const { token } = await auth.getPluginRequestToken({
              onBehalfOf: credentials,
              targetPluginId: 'catalog',
            });
            const params = new URLSearchParams();
            params.append('filter', 'kind=Template');
            if (input.namespace) {
              params.append('filter', `metadata.namespace=${input.namespace}`);
            }
            const url = `${baseUrl}/entities?${params.toString()}`;
            logger.info(`[scaffolder:templates-list] GET ${url}`);
            const res = await fetch(url, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
              throw new Error(
                `Catalog returned HTTP ${res.status}: ${await res.text()}`,
              );
            }
            const entities: any[] = await res.json();
            const templates = entities.map(e => ({
              name: String(e?.metadata?.name ?? ''),
              namespace: String(e?.metadata?.namespace ?? 'default'),
              title: e?.metadata?.title as string | undefined,
              description: e?.metadata?.description as string | undefined,
            }));
            return { output: { templates, total: templates.length } };
          },
        });
      },
    });
  },
});
