import { Suspense } from "react";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { getCurrentUser } from "@/lib/auth";
import "./login-form.css";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginForm />}>
      <LoginPageContent />
    </Suspense>
  );
}

async function LoginPageContent() {
  if (await getCurrentUser()) redirect("/");
  return <LoginForm />;
}
