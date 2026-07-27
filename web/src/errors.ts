export type ErrorAction = {
  label: string;
  path: string;
};

export class FriendlyError extends Error {
  title: string;
  action?: ErrorAction;

  constructor(title: string, message: string, action?: ErrorAction) {
    super(message);
    this.name = "FriendlyError";
    this.title = title;
    this.action = action;
  }
}
