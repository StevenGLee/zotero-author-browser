export interface CreatorNameLike {
  firstName: string;
  lastName: string;
}

export type CreatorNameMatchType =
  | "normalized-full-name"
  | "abbrev-high-confidence"
  | "same-last-name-initial-manual";

export function normalizeNamePart(value: string) {
  return (value || "")
    .toLowerCase()
    .replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>{}\[\]\\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitNameTokens(value: string) {
  return normalizeNamePart(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

export function getNormalizedFullName(creator: CreatorNameLike) {
  const firstName = normalizeNamePart(creator.firstName || "");
  const lastName = normalizeNamePart(creator.lastName || "");
  return `${firstName} ${lastName}`.trim();
}

export function getFirstInitial(name: string) {
  const token = splitNameTokens(name)[0] || "";
  return token ? token[0] : "";
}

export function isInitialLike(name: string) {
  const tokens = splitNameTokens(name);
  if (tokens.length === 0) {
    return false;
  }
  return tokens.some((token) => token.length === 1);
}

export function getFirstNameSignature(name: string) {
  const tokens = splitNameTokens(name);
  if (tokens.length === 0) {
    return "";
  }
  return tokens.map((token) => token[0] || "").join("");
}

export function hasAbbreviationForm(name: string) {
  const tokens = splitNameTokens(name);
  if (tokens.length === 0) {
    return false;
  }
  return (
    tokens.some((token) => token.length === 1) ||
    (tokens.length === 1 && tokens[0].length <= 2)
  );
}

export function isPureAbbreviationForm(name: string) {
  const tokens = splitNameTokens(name);
  if (tokens.length === 0) {
    return false;
  }
  const allShort = tokens.every((token) => token.length <= 2);
  const compactLength = tokens.join("").length;
  return allShort && compactLength <= 4;
}

export function getCreatorNameMatchType(
  mainCreator: CreatorNameLike,
  candidate: CreatorNameLike,
): CreatorNameMatchType | null {
  const mainFirstName = normalizeNamePart(mainCreator.firstName || "");
  const mainLastName = normalizeNamePart(mainCreator.lastName || "");
  const candidateFirstName = normalizeNamePart(candidate.firstName || "");
  const candidateLastName = normalizeNamePart(candidate.lastName || "");

  const mainFullName = `${mainFirstName} ${mainLastName}`.trim();
  const candidateFullName = `${candidateFirstName} ${candidateLastName}`.trim();
  if (mainFullName && mainFullName === candidateFullName) {
    return "normalized-full-name";
  }

  const sameLastName = mainLastName && mainLastName === candidateLastName;
  if (!sameLastName) {
    return null;
  }
  const mainInitial = getFirstInitial(mainFirstName);
  const candidateInitial = getFirstInitial(candidateFirstName);
  if (!mainInitial || !candidateInitial || mainInitial !== candidateInitial) {
    return null;
  }

  const mainSignature = getFirstNameSignature(mainFirstName);
  const candidateSignature = getFirstNameSignature(candidateFirstName);
  const hasAbbrev =
    hasAbbreviationForm(mainFirstName) || hasAbbreviationForm(candidateFirstName);
  if (
    hasAbbrev &&
    mainSignature &&
    candidateSignature &&
    mainSignature === candidateSignature
  ) {
    return "abbrev-high-confidence";
  }

  if (hasAbbrev) {
    return "same-last-name-initial-manual";
  }
  return null;
}
