import React, { createContext, useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  loginUser,
  logoutUser,
  registerUser,
  resendVerificationCode,
  verifyEmail,
} from "../api";
import Loader from "../components/Loader";
import type { UserInterface } from "../interfaces/user";
import type {
  RegisterResultData,
  ResendCodeResultData,
  VerifyEmailResultData,
} from "../interfaces/api";
import { LocalStorage, requestHandler, type ApiFailure } from "../utils";

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

  const logout = async () => {
    await requestHandler(
      async () => await logoutUser(),
      setIsAuthPending,
      () => {
        setUser(null);
        setToken(null);
        LocalStorage.clear();
        navigate("/login");
      },
      (err) => toast.error(err),
    );
  };

  useEffect(() => {
    const _token = LocalStorage.get("token");
    const _user = LocalStorage.get("user");
    if (_token && _user?._id) {
      setUser(_user);
      setToken(_token);
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
