export type AppMode = "mock" | "production";

const configuredMode = import.meta.env.VITE_APP_MODE?.trim().toLowerCase();

export const appMode: AppMode = configuredMode === "production" ? "production" : "mock";
export const isMockMode = appMode === "mock";

export const environmentLabel = isMockMode
  ? "Mock mode · dados locais"
  : "Production · AWS";
