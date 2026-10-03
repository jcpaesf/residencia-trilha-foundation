import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  type CognitoUserSession,
  type ICognitoUserData,
} from "amazon-cognito-identity-js";
import { isMockMode } from "./config";

export type AuthenticatedUser = {
  sub: string;
  email: string;
  name: string;
  accessToken: string;
  idToken: string;
};

export type NewPasswordChallenge = {
  cognitoUser: CognitoUser;
  userAttributes: Record<string, string>;
};

export type SignInResult =
  | { status: "authenticated"; user: AuthenticatedUser }
  | { status: "new-password-required"; challenge: NewPasswordChallenge };

export type SignUpResult = { confirmed: boolean; destination?: string };

const mockSessionKey = "foundation-market:mock-session";
let pool: CognitoUserPool | undefined;

const requiredCognitoConfig = () => {
  const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID?.trim();
  const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID?.trim();
  if (!userPoolId || !clientId) {
    throw new Error("Configure VITE_COGNITO_USER_POOL_ID e VITE_COGNITO_CLIENT_ID.");
  }
  return { userPoolId, clientId };
};

const getPool = () => {
  if (pool) return pool;
  const { userPoolId, clientId } = requiredCognitoConfig();
  pool = new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId });
  return pool;
};

const createCognitoUser = (email: string) => {
  const userData: ICognitoUserData = { Username: email, Pool: getPool() };
  return new CognitoUser(userData);
};

const userFromSession = (session: CognitoUserSession, fallbackEmail = ""): AuthenticatedUser => {
  const payload = session.getIdToken().payload;
  const email = String(payload.email ?? fallbackEmail);
  const fallbackName = email.split("@")[0]?.replace(/[._-]+/g, " ") || "Usuário";
  return {
    sub: String(payload.sub ?? email),
    email,
    name: String(payload.name ?? payload.given_name ?? fallbackName),
    accessToken: session.getAccessToken().getJwtToken(),
    idToken: session.getIdToken().getJwtToken(),
  };
};

const mockUser = (email: string): AuthenticatedUser => ({
  sub: "mock-user",
  email,
  name: window.localStorage.getItem("foundation-market:mock-name")
    ?? email.split("@")[0]?.replace(/[._-]+/g, " ")
    ?? "Usuário mock",
  accessToken: "mock-access-token",
  idToken: "mock-id-token",
});

const delay = (duration: number) =>
  new Promise((resolve) => window.setTimeout(resolve, duration));

export const restoreSession = async (): Promise<AuthenticatedUser | null> => {
  if (isMockMode) {
    const raw = window.localStorage.getItem(mockSessionKey);
    return raw ? (JSON.parse(raw) as AuthenticatedUser) : null;
  }
  const cognitoUser = getPool().getCurrentUser();
  if (!cognitoUser) return null;
  return new Promise((resolve) => {
    cognitoUser.getSession((error: Error | null, session: CognitoUserSession | null) => {
      resolve(error || !session?.isValid() ? null : userFromSession(session, cognitoUser.getUsername()));
    });
  });
};

export const signUp = async (
  name: string,
  email: string,
  password: string,
): Promise<SignUpResult> => {
  if (isMockMode) {
    await delay(400);
    window.localStorage.setItem("foundation-market:mock-name", name);
    return { confirmed: true };
  }
  const attributes = [
    new CognitoUserAttribute({ Name: "email", Value: email }),
    new CognitoUserAttribute({ Name: "name", Value: name }),
  ];
  return new Promise((resolve, reject) => {
    getPool().signUp(email, password, attributes, [], (error, result) => {
      if (error) return reject(error);
      resolve({
        confirmed: Boolean(result?.userConfirmed),
        destination: result?.codeDeliveryDetails?.Destination,
      });
    });
  });
};

export const confirmSignUp = async (email: string, code: string): Promise<void> => {
  if (isMockMode) return void (await delay(300));
  return new Promise((resolve, reject) => {
    createCognitoUser(email).confirmRegistration(code, true, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
};

export const resendSignUpCode = async (email: string): Promise<void> => {
  if (isMockMode) return void (await delay(300));
  return new Promise((resolve, reject) => {
    createCognitoUser(email).resendConfirmationCode((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
};

export const signIn = async (email: string, password: string): Promise<SignInResult> => {
  if (isMockMode) {
    await delay(400);
    const user = mockUser(email);
    window.localStorage.setItem(mockSessionKey, JSON.stringify(user));
    return { status: "authenticated", user };
  }
  const cognitoUser = createCognitoUser(email);
  const details = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise((resolve, reject) => {
    cognitoUser.authenticateUser(details, {
      onSuccess: (session) => resolve({ status: "authenticated", user: userFromSession(session, email) }),
      onFailure: reject,
      newPasswordRequired: (userAttributes) => {
        const attributes = { ...userAttributes } as Record<string, string>;
        delete attributes.email_verified;
        resolve({ status: "new-password-required", challenge: { cognitoUser, userAttributes: attributes } });
      },
    });
  });
};

export const completeNewPassword = async (
  challenge: NewPasswordChallenge,
  password: string,
): Promise<AuthenticatedUser> => new Promise((resolve, reject) => {
  challenge.cognitoUser.completeNewPasswordChallenge(password, challenge.userAttributes, {
    onSuccess: (session) => resolve(userFromSession(session, challenge.cognitoUser.getUsername())),
    onFailure: reject,
  });
});

export const requestPasswordReset = async (email: string): Promise<void> => {
  if (isMockMode) return void (await delay(300));
  return new Promise((resolve, reject) => {
    createCognitoUser(email).forgotPassword({ onSuccess: () => resolve(), onFailure: reject });
  });
};

export const confirmPasswordReset = async (
  email: string,
  code: string,
  password: string,
): Promise<void> => {
  if (isMockMode) return void (await delay(300));
  return new Promise((resolve, reject) => {
    createCognitoUser(email).confirmPassword(code, password, {
      onSuccess: () => resolve(),
      onFailure: reject,
    });
  });
};

export const signOut = (): void => {
  if (isMockMode) window.localStorage.removeItem(mockSessionKey);
  else getPool().getCurrentUser()?.signOut();
};
