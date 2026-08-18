export class PasswordCrypterError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "PasswordCrypterError";
    this.code = code;
  }
}

export function unrecognizedFormatError() {
  return new PasswordCrypterError("Format de secret non reconnu.", "UNRECOGNIZED_FORMAT");
}

export function unsupportedVersionError(version) {
  return new PasswordCrypterError(
    `Cette version du secret (${version}) n'est pas prise en charge par cette version de Password Crypter.`,
    "UNSUPPORTED_VERSION"
  );
}

export function decryptionFailedError() {
  return new PasswordCrypterError(
    "Impossible de déchiffrer ce secret. La clé est incorrecte ou les données sont endommagées.",
    "DECRYPTION_FAILED"
  );
}
