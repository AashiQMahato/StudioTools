import { EditorSection } from "@/components/landing/EditorSection";
import { FaqSection } from "@/components/landing/FaqSection";
import { Hero } from "@/components/landing/Hero";
import { ShowcaseSection } from "@/components/landing/ShowcaseSection";
import { ToolsSection } from "@/components/landing/ToolsSection";
import { WhySection } from "@/components/landing/WhySection";
import { WorkflowSection } from "@/components/landing/WorkflowSection";

export function HomePage() {
    return (
        <>
            <Hero />
            <ShowcaseSection />
            <ToolsSection />
            <WorkflowSection />
            <EditorSection />
            <WhySection />
            <FaqSection />
        </>
    );
}
