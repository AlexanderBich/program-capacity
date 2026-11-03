type UserRole = 'ADMIN' | 'OPERATOR' | 'VIEWER';

export type User = {
  id: string;
  email: string;
  role: UserRole;
};

export type Session = {
  accessToken: string;
  accessTokenExpiresAt: string;
  user: User;
};

export type LoginInput = {
  email: string;
  password: string;
};
