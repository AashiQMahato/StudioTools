import { ArrowDown, Check } from "lucide-react";
import { useState } from "react";
import { UploadButton } from "@/components/common/UploadButton";
import { Button } from "@/components/ui/base/buttons/button";
import { ROUTES } from "@/lib/constants/routes";
import { useT } from "@/i18n";
import { HeroShowcase } from "./HeroShowcase";

/**
 * The first viewport: what the product does in one line, a way in, the reasons to trust it — beside
 * the product itself, running, in a calm window frame (stacked on narrow screens). Light comes from above (a soft spotlight that fades
 * out), so the eye moves from the headline down to the reel.
 */
export function Hero() {
    const t = useT();
    const copy = t.hero;
    const [uploadError, setUploadError] = useState<string | null>(null);
    const pill = "press-scale rounded-full before:rounded-full";

    return (
        <section aria-labelledby="hero-title" className="hero-premium relative isolate -mt-18 overflow-x-clip pt-18">
            {/* Wide screens: the words on the left, the product running on the right — both in the first view.
                Narrow screens: words first, then the reel, in one column exactly the screen's width (an
                auto-sized column would grow to the reel's step bar and push the text off-screen). */}
            <div className="page-container grid grid-cols-1 items-center gap-12 pt-6 pb-16 md:pt-10 md:pb-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)] lg:gap-10 xl:grid-cols-[minmax(0,33rem)_minmax(0,1fr)] lg:pt-12 lg:pb-12 xl:gap-16">
                <div className="mx-auto flex max-w-2xl flex-col items-center text-center lg:mx-0 lg:max-w-none lg:items-start lg:text-left">
                    <p className="animate-enter hero-badge inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-secondary [--i:1] sm:text-sm">
                        <span aria-hidden className="size-2 rounded-full bg-[var(--brand)] shadow-[0_0_0_3px_rgb(3_105_161/0.15)]" />
                        {copy.badge}
                    </p>
                    <h1 id="hero-title" className="animate-enter mt-5 text-hero text-balance text-primary [--i:2] lg:text-[2.75rem] xl:text-[3rem]">
                        <span className="sm:block">{copy.titleLead}</span> <span className="hero-accent sm:block">{copy.titleAccent}</span>
                    </h1>

                    <div className="animate-enter mt-8 flex flex-wrap items-center justify-center gap-3 [--i:4] lg:justify-start">
                        <UploadButton size="xl" label={t.common.startEditing} navigateTo={ROUTES.editor} onErrorChange={setUploadError} buttonClassName={`${pill} px-7 shadow-[0_10px_30px_-10px_rgb(3_105_161/0.55)]`} />
                        <Button size="xl" color="secondary" href="#tools" iconTrailing={ArrowDown} className={`${pill} px-6`}>
                            {copy.exploreTools}
                        </Button>
                    </div>
                    {uploadError && (
                        <p role="alert" className="mt-4 text-sm text-error-primary">
                            {uploadError}
                        </p>
                    )}

                    <ul className="animate-enter mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-tertiary [--i:5] lg:justify-start">
                        {copy.trust.map((item) => (
                            <li key={item} className="inline-flex items-center gap-1.5">
                                <Check className="size-4 text-success-primary" strokeWidth={2.5} aria-hidden />
                                {item}
                            </li>
                        ))}
                    </ul>
                </div>

                <HeroShowcase className="animate-enter [--i:4] lg:-mr-4 lg:ml-0 lg:w-auto lg:max-w-none xl:-mr-20 2xl:-mr-28" />
            </div>
        </section>
    );
}
