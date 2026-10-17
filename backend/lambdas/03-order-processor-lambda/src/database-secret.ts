import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

type DatabaseSecret = {
  username: string;
  password: string;
};

const secrets = new SecretsManagerClient({});
let cachedSecret: Promise<DatabaseSecret> | undefined;

export const getDatabaseSecret = (): Promise<DatabaseSecret> => {
  if (cachedSecret) return cachedSecret;

  const localSecret = process.env.DB_SECRET_JSON;
  if (localSecret && process.env.ALLOW_LOCAL_DB_SECRET === "true") {
    const value = JSON.parse(localSecret) as Partial<DatabaseSecret>;
    if (!value.username || !value.password) {
      throw new Error("DB_SECRET_JSON must contain username and password.");
    }
    cachedSecret = Promise.resolve({ username: value.username, password: value.password });
    return cachedSecret;
  }

  const secretId = process.env.DB_SECRET_ARN;
  if (!secretId) throw new Error("DB_SECRET_ARN is required when DATA_SOURCE=rds.");

  cachedSecret = secrets.send(new GetSecretValueCommand({ SecretId: secretId })).then((response) => {
    if (!response.SecretString) throw new Error("Database secret does not contain SecretString.");
    const value = JSON.parse(response.SecretString) as Partial<DatabaseSecret>;
    if (!value.username || !value.password) {
      throw new Error("Database secret must contain username and password.");
    }
    return { username: value.username, password: value.password };
  });

  return cachedSecret;
};
