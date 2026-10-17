import forge from "node-forge";
export type MitmCa = {
    /** ca private key */
    key: forge.pki.rsa.PrivateKey;
    /** ca certificate */
    cert: forge.pki.Certificate;
    /** ca private key pem */
    keyPem: string;
    /** ca certificate pem */
    certPem: string;
};
export declare function getDefaultMitmCertDir(): string;
export declare function resolveMitmCertDir(mitmCertDir?: string): string;
export declare function loadOrCreateMitmCa(mitmDir: string): Promise<MitmCa>;
export declare function loadOrCreateMitmCaSync(mitmDir: string): MitmCa;
export declare function generatePositiveSerialNumber(byteLength?: number): string;
export declare function isNonNegativeSerialNumberHex(serialNumber: string): boolean;
export declare function getCertificateSubjectKeyIdentifierBytes(cert: forge.pki.Certificate): string | undefined;
export declare function certificateHasAuthorityKeyIdentifier(cert: forge.pki.Certificate, expectedKeyIdentifierBytes: string): boolean;
export declare function mitmCaHasRequiredKeyIdentifiers(cert: forge.pki.Certificate): boolean;
export declare function mitmLeafHasRequiredKeyIdentifiers(caCert: forge.pki.Certificate, leafCert: forge.pki.Certificate): boolean;
//# sourceMappingURL=mitm.d.ts.map