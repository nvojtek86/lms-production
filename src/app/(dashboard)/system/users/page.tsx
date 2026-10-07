
import {useUi} from "@/i18n/useUi";
import { UserTableV2 } from "@/features/users";

export default function SystemUsersPage() {
  const ui = useUi();
  return (
    <div className="container mx-auto">
      <UserTableV2 title={ui("All Users")} />
    </div>
  );
}


