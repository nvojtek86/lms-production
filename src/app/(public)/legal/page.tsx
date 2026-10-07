
import {useUi} from "@/i18n/useUi";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function LegalPage() {
  const ui = useUi();
  return (
    <div className="min-h-screen bg-background">
      {/* Simple header */}
      <header className="border-b py-4 px-6">
        <Link 
          href="/" 
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={16} />
          {ui("Back to Home")}</Link>
      </header>

      {/* Static content */}
      <main className="max-w-3xl mx-auto px-6 py-12 space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">{ui("Legal")}</h1>
          <p className="text-muted-foreground">
            {ui("Terms of Service and Privacy Policy.")}</p>
        </div>

        <div className="rounded-lg border bg-card p-6 space-y-8">
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-foreground">{ui("Terms of Service")}</h2>
            <div className="text-muted-foreground leading-relaxed space-y-3">
              {/* Replace this placeholder with your actual Terms of Service */}
              <p>
                {ui("By accessing and using this learning management system, you agree to comply with and be bound by the following terms and conditions.")}</p>
              <p>
                <strong className="text-foreground">{ui("1. Use License:")}</strong> {ui("Permission is granted to temporarily access the materials on this platform for personal, non-commercial use only.")}</p>
              <p>
                <strong className="text-foreground">{ui("2. User Responsibilities:")}</strong> {ui("You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.")}</p>
              <p>
                <strong className="text-foreground">{ui("3. Disclaimer:")}</strong> {ui("The materials on this platform are provided on an 'as is' basis. We make no warranties, expressed or implied.")}</p>
              {/* Add more terms as needed */}
            </div>
          </section>

          <hr className="border-border" />

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-foreground">{ui("Privacy Policy")}</h2>
            <div className="text-muted-foreground leading-relaxed space-y-3">
              {/* Replace this placeholder with your actual Privacy Policy */}
              <p>
                {ui("Your privacy is important to us. This privacy policy explains how we collect, use, and protect your personal information.")}</p>
              <p>
                <strong className="text-foreground">{ui("Information We Collect:")}</strong> {ui("We collect information you provide directly, such as your name, email address, and organization affiliation.")}</p>
              <p>
                <strong className="text-foreground">{ui("How We Use Your Information:")}</strong> {ui("We use your information to provide and improve our services, communicate with you, and ensure platform security.")}</p>
              <p>
                <strong className="text-foreground">{ui("Data Retention:")}</strong> {ui("We retain your personal data only for as long as necessary to fulfill the purposes outlined in this policy.")}</p>
              {/* Add more policy details as needed */}
            </div>
          </section>
        </div>

        <p className="text-sm text-muted-foreground text-center">
          {ui("Last updated: January 2026")}</p>
      </main>
    </div>
  );
}
