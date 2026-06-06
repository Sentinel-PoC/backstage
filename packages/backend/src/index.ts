import { createBackend } from '@backstage/backend-defaults';
import { rootHttpRouterServiceFactory } from '@backstage/backend-defaults/rootHttpRouter';
import session from 'express-session';

// OPS-371: MCP action modules — static import so backend.add() receives
// BackendFeature values synchronously before backend.start() is called.
import {
  catalogEntityGetModule,
  catalogEntitiesSearchModule,
  scaffolderTemplatesListModule,
} from './mcpCatalogActions';

// Override rootHttpRouter to add express-session middleware.
// Required for OIDC auth: openid-client passport strategy stores a
// nonce in req.session during the OAuth2 authorization code flow.
const customRootHttpRouter = rootHttpRouterServiceFactory({
  configure: ({ app, config, middleware, routes, healthRouter }) => {
    const secret = config.getString('backend.session.secret');
    app.use(session({
      secret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: 'auto',
        httpOnly: true,
        sameSite: 'lax',
      },
    }) as any);
    app.use(middleware.helmet());
    app.use(middleware.cors());
    app.use(middleware.compression());
    app.use(middleware.logging());
    app.use(healthRouter);
    app.use(routes);
    app.use(middleware.notFound());
    app.use(middleware.error());
  },
});

const backend = createBackend();

// Custom rootHttpRouter with session support
backend.add(customRootHttpRouter);

// --- Core ---
backend.add(import('@backstage/plugin-app-backend'));
backend.add(import('@backstage/plugin-proxy-backend'));

// --- Auth (Keycloak OIDC) ---
backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('@backstage/plugin-auth-backend-module-oidc-provider'));

// --- Catalog ---
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(import('@backstage/plugin-catalog-backend-module-gitlab'));
backend.add(import('@backstage/plugin-catalog-backend-module-scaffolder-entity-model'));
backend.add(import('@backstage/plugin-catalog-backend-module-logs'));

// --- Kubernetes (OKD) ---
backend.add(import('@backstage/plugin-kubernetes-backend'));

// --- TechDocs (local builder, air-gapped) ---
backend.add(import('@backstage/plugin-techdocs-backend'));

// --- Scaffolder ---
backend.add(import('@backstage/plugin-scaffolder-backend'));
backend.add(import('@backstage/plugin-scaffolder-backend-module-notifications'));

// --- Search (PostgreSQL) ---
backend.add(import('@backstage/plugin-search-backend'));
backend.add(import('@backstage/plugin-search-backend-module-pg'));
backend.add(import('@backstage/plugin-search-backend-module-catalog'));
backend.add(import('@backstage/plugin-search-backend-module-techdocs'));

// --- Permissions ---
backend.add(import('@backstage/plugin-permission-backend'));
backend.add(import('@backstage/plugin-permission-backend-module-allow-all-policy'));

// --- Notifications ---
backend.add(import('@backstage/plugin-notifications-backend'));
backend.add(import('@backstage/plugin-signals-backend'));

// --- ArgoCD ---
backend.add(import('@roadiehq/backstage-plugin-argo-cd-backend'));

// --- MCP Actions (Model Context Protocol) ---
backend.add(import('@backstage/plugin-mcp-actions-backend'));

// OPS-371: Register catalog and scaffolder actions with the MCP Actions Registry.
// Modules use pluginId 'mcp-actions' to share the plugin-scoped actionsRegistryService.
backend.add(catalogEntityGetModule);
backend.add(catalogEntitiesSearchModule);
backend.add(scaffolderTemplatesListModule);

backend.start();
