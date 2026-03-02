export function ensureSessionStateShape(session: any): boolean {
  let mutated = false;

  if (!Array.isArray(session.rooms)) {
    session.rooms = [];
    mutated = true;
  }

  if (!Array.isArray(session.monsters)) {
    session.monsters = [];
    mutated = true;
  }

  if (
    !session.sessionFlags ||
    typeof session.sessionFlags !== "object" ||
    Array.isArray(session.sessionFlags)
  ) {
    session.sessionFlags = {};
    mutated = true;
  }

  return mutated;
}
