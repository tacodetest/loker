import ChangePasswordForm from "@/components/ChangePasswordForm";
import { requireCurrentUser } from "@/lib/auth";

export const instant = false;

export default async function AccountPage() {
  const user = await requireCurrentUser();
  return (
    <main className="main-content">
      <header className="page-title-row">
        <div>
          <p className="eyebrow">PENGATURAN AKUN</p>
          <h1>Akun {user.name}</h1>
          <p>Kelola password untuk username <strong>{user.id}</strong>.</p>
        </div>
      </header>
      <ChangePasswordForm />
    </main>
  );
}
