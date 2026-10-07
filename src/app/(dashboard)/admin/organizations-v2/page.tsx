
import {useUi} from "@/i18n/useUi";
import { OrganizationsTableV2 } from "@/features/organizations";

export default function AdminOrganizationsV2Page() {
  const ui = useUi();
  return (
    <div className="container mx-auto">
      <OrganizationsTableV2 title={ui("Organizations")} subtitle={ui("Manage all organizations in the system")} />
    </div>
  );
}

