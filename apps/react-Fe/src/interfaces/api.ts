import type { UserInterface } from "./user";

export interface FreeAPISuccessResponseInterface<T = unknown> {
  data: T;
  message: string;
  statusCode: number;
  success: boolean;
}

export interface LoginResponseData {
  accessToken: string;
  refreshToken?: string;
  findUser: UserInterface;
}