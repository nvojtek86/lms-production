export const getCertificateTemplate = async (_templateId: string) => {
  void _templateId;
  return null;
};

export const generateCertificate = async (_userId: string, _courseId: string) => {
  void _userId;
  void _courseId;
  return null;
};

export { CertificatesTableV2, type CertificateRowV2 } from "@/features/certificates/components/CertificatesTableV2";
export {
  CertificateAwardModal,
  type AwardedCertificate,
} from "@/features/certificates/components/CertificateAwardModal";

