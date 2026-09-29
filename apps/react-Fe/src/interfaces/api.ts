import type { UserInterface } from "./user";

export interface FreeAPISuccessResponseInterface<T = unknown> {
  data: T;
  message: string;
  statusCode: number;
  success: boolean;
  /** Machine-readable failure code, mirrors the backend `ApiErrorCode`. */
  code?: string;
  /** Field-level problems, each mapped back onto a form input. */
  errors?: ApiFieldErrorInterface[];
}

export interface ApiFieldErrorInterface {
  path: string;
  message: string;
}

export interface LoginResponseData {
  accessToken: string;
  refreshToken?: string;
  findUser: UserInterface;
}