import { defineRailway, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "mutterings";
export default defineRailway(() => {
  const mutterings = service("mutterings", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/api/health",
    healthcheckTimeout: 30,
    replicas: { "us-east4-eqdc4a": 1 },
  });

  return project("mutterings", {
    variables: { managed: false },
    resources: [mutterings],
  });
});
