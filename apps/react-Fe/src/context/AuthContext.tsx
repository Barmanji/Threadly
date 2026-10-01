import React, { createContext, useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  completeAccountRecovery,
  loginUser,
  logoutUser,
  registerUser,
  requestAccountRecovery,
  resendVerificationCode,
  verifyEmail,
} from "../api";
import Loader from "../components/Loader";
import type { UserInterface } from "../interfaces/user";
import type {
  CompleteRecoveryResultData,
  RecoveryCodeResultData,
  RegisterResultData,
  ResendCodeResultData,
  VerifyEmailResultData,
} from "../interfaces/api";
import { LocalStorage, requestHandler, type ApiFailure } from "../utils";
import * as Sentry from "@sentry/react";

/**
 * Point every subsequent Sentry event at this account.
 *
 * `id` and `username` only — the email is deliberately left out. `sendDefaultPii`
 * stays false in the Sentry config, so nothing is attached implicitly; this is
 * the only place identity enters an event, and it is two fields. Add
 * `email:` here if you decide email-in-Sentry is worth it for support triage.
 */
const identifySentryUser = (user: UserInterface | null) => {
  Sentry.setUser(user?._id ? { id: user._id, username: user.username } : null);
};

/** What `register` resolves to so the page can move to the verify step. */
export type RegisterOutcome =
  | { ok: true; data: RegisterResultData }
  | { ok: false; failure: ApiFailure }
  | null;

interface AuthContextValue {
  user: UserInterface | null;
  token: string | null;
  login: (data: { username: string; password: string }) => Promise<ApiFailure | null>;
  register: (data: {
    email: string;
    username: string;
    password: string;
    avatar: File | null;
  }) => Promise<RegisterOutcome>;
  verifyEmail: (data: { email: string; code: string }) => Promise<VerifyEmailResultData | ApiFailure>;
  resendVerificationCode: (data: {
    email: string;
  }) => Promise<ResendCodeResultData | ApiFailure>;
  requestAccountRecovery: (data: {
    email: string;
  }) => Promise<RecoveryCodeResultData | ApiFailure>;
  completeAccountRecovery: (data: {
    email: string;
    code: string;
    newPassword?: string;
    newUsername?: string;
    avatar?: File | null;
  }) => Promise<CompleteRecoveryResultData | ApiFailure>;
  logout: () => Promise<void>;
  /** True only for the initial token restore, which gates the whole tree. */
  isBootstrapping: boolean;
  /** True while a login/register/verify request is in flight. */
  isAuthPending: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  login: async () => null,
  register: async () => null,
  verifyEmail: async () => ({ message: "", statusCode: 0, code: "UNKNOWN", fieldErrors: [], isNetworkError: false }),
  resendVerificationCode: async () => ({ message: "", statusCode: 0, code: "UNKNOWN", fieldErrors: [], isNetworkError: false }),
  requestAccountRecovery: async () => ({ message: "", statusCode: 0, code: "UNKNOWN", fieldErrors: [], isNetworkError: false }),
  completeAccountRecovery: async () => ({ message: "", statusCode: 0, code: "UNKNOWN", fieldErrors: [], isNetworkError: false }),
  logout: async () => {},
  isBootstrapping: true,
  isAuthPending: false,
});

const useAuth = () => useContext(AuthContext);

const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Two distinct flags, on purpose:
  //  - `isBootstrapping` swaps the whole tree for the loader, but only while
  //    restoring a saved session. It must NOT be set during register/login:
  //    doing so made the register form (and everything the user typed)
  //    disappear the instant they pressed submit.
  //  - `isAuthPending` drives a spinner on the submit button only.
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isAuthPending, setIsAuthPending] = useState(false);
  const [user, setUser] = useState<UserInterface | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const navigate = useNavigate();

  const login = async (data: { username: string; password: string }) => {
    return requestHandler(
      async () => await loginUser(data),
      setIsAuthPending,
      (res) => {
        const { data } = res;
        setUser(data.findUser);
        setToken(data.accessToken);
        identifySentryUser(data.findUser);
        LocalStorage.set("user", data.findUser);
        LocalStorage.set("token", data.accessToken);
        if (data.refreshToken) {
          LocalStorage.set("refreshToken", data.refreshToken);
        }
        navigate("/chat");
      },
      // The page renders the message inline where it matters, so there is no
      // toast here — a toast would duplicate what the user is already reading.
      () => {},
    );
  };

  /**
   * Create the account, then hand the caller the result so it can show the
   * verification step. Nothing is navigated or reset here: the register page
   * keeps every value the user typed so they can go back and fix a field.
   */
  const register = async (data: {
    email: string;
    username: string;
    password: string;
    avatar: File | null;
  }): Promise<RegisterOutcome> => {
    let outcome: RegisterOutcome = null;

    const failure = await requestHandler(
      async () => await registerUser(data),
      setIsAuthPending,
      (res) => {
        outcome = { ok: true, data: res.data };
      },
      () => {},
    );

    return failure ? { ok: false, failure } : outcome;
  };

  const verifyEmailCode = async (data: { email: string; code: string }) => {
    let result: VerifyEmailResultData | null = null;

    const failure = await requestHandler(
      async () => await verifyEmail(data),
      setIsAuthPending,
      (res) => {
        result = res.data;
      },
      () => {},
    );

    return failure ?? result!;
  };

  const resendCode = async (data: { email: string }) => {
    let result: ResendCodeResultData | null = null;

    const failure = await requestHandler(
      async () => await resendVerificationCode(data),
      setIsAuthPending,
      (res) => {
        result = res.data;
      },
      () => {},
    );

    return failure ?? result!;
  };

  /**
   * Ask for a code that authorises changing an existing account's details.
   *
   * Reached from the register form when the address already has an account, so
   * it also covers the real forgot-password case — the account is fully
   * working, the user simply cannot get in.
   */
  const requestRecovery = async (data: { email: string }) => {
    let result: RecoveryCodeResultData | null = null;

    const failure = await requestHandler(
      async () => await requestAccountRecovery(data),
      setIsAuthPending,
      (res) => {
        result = res.data;
      },
      () => {},
    );

    return failure ?? result!;
  };

  /**
   * Hand the code back with whatever the user changed.
   *
   * Returns no tokens on purpose. This is reached without a session, so
   * minting one here would be a second, quieter way to take the account — the
   * page logs in normally afterwards, with the password the user just chose.
   */
  const completeRecovery = async (data: {
    email: string;
    code: string;
    newPassword?: string;
    newUsername?: string;
    avatar?: File | null;
  }) => {
    let result: CompleteRecoveryResultData | null = null;

    const failure = await requestHandler(
      async () => await completeAccountRecovery(data),
      setIsAuthPending,
      (res) => {
        result = res.data;
      },
      () => {},
    );

    return failure ?? result!;
  };

  const logout = async () => {
    await requestHandler(
      async () => await logoutUser(),
      setIsAuthPending,
      () => {
        setUser(null);
        setToken(null);
        /*
         * Without this the signed-out session keeps reporting as the user who
         * just logged out, and the next person to use the browser attaches
         * their bugs to somebody else's account.
         */
        identifySentryUser(null);
        LocalStorage.clear();
        navigate("/login");
      },
      (err) => toast.error(err),
    );
  };

  useEffect(() => {
    const _token = LocalStorage.get<string>("token");
    const _user = LocalStorage.get<UserInterface>("user");
    if (_token && _user?._id) {
      setUser(_user);
      setToken(_token);
      /*
       * Re-establish identity on a page reload. `Sentry.init` runs fresh every
       * load and starts with no user, so a crash on the first render of a
       * restored session would otherwise be anonymous.
       */
      identifySentryUser(_user);
    }
    setIsBootstrapping(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        // Consumed by SocketContext to authenticate the handshake.
        token,
        login,
        register,
        verifyEmail: verifyEmailCode,
        resendVerificationCode: resendCode,
        requestAccountRecovery: requestRecovery,
        completeAccountRecovery: completeRecovery,
        logout,
        isBootstrapping,
        isAuthPending,
      }}
    >
      {isBootstrapping ? <Loader /> : children}
    </AuthContext.Provider>
  );
};

export { AuthContext, AuthProvider, useAuth };
