"use strict";

// ScrollTrigger.batch follows the staggered-reveal pattern from the GSAP demo.
function initPageReveal() {
    if (!window.gsap || !window.ScrollTrigger) return;
    gsap.registerPlugin(ScrollTrigger);

    let headerRevealed = false;
    const media = gsap.matchMedia();
    media.add(
        {
            mobile: "(width < 768px)",
            desktop: "(width >= 768px)",
            reduceMotion: "(prefers-reduced-motion: reduce)",
        },
        (context) => {
            if (context.conditions.reduceMotion) return;

            const targets = Array.from(
                document.querySelectorAll("[data-reveal]:not(.footer--no-animation *)"),
            ).filter(
                (element) =>
                    element.dataset.revealed !== "true" &&
                    element.getClientRects().length,
            );
            const pending = new Set(targets);
            const distance = context.conditions.mobile ? 18 : 28;

            const fadeOnly = (element) => element.dataset.reveal === "fade";
            const moving = targets.filter((element) => !fadeOnly(element));
            const fading = targets.filter(fadeOnly);
            // Swiper owns carousel geometry: reveal it with opacity only.
            if (moving.length) gsap.set(moving, { opacity: 0, y: distance });
            if (fading.length) gsap.set(fading, { opacity: 0 });

            // Opacity preserves keyboard access; focus finishes a running reveal too.
            context.add("reveal", (batch, immediate = false) => {
                const elements = batch.filter((element) =>
                    immediate
                        ? targets.includes(element)
                        : pending.has(element),
                );
                if (!elements.length) return;
                elements.forEach((element) => pending.delete(element));
                for (const onlyFade of [false, true]) {
                    const group = elements.filter(
                        (element) => fadeOnly(element) === onlyFade,
                    );
                    if (!group.length) continue;
                    gsap.killTweensOf(group);
                    const clearProps = onlyFade
                        ? "opacity"
                        : "opacity,transform";
                    if (
                        immediate ||
                        group.some((element) =>
                            element.contains(document.activeElement),
                        )
                    ) {
                        gsap.set(group, { clearProps });
                        group.forEach((element) => {
                            element.dataset.revealed = "true";
                        });
                        continue;
                    }
                    // Keep each staggered tween independently cancellable when
                    // keyboard focus reaches a delayed or already moving item.
                    group.forEach((element, index) => {
                        gsap.to(element, {
                            opacity: 1,
                            ...(onlyFade ? {} : { y: 0 }),
                            duration: 0.7,
                            delay: onlyFade ? 0 : index * 0.1,
                            ease: "power2.out",
                            overwrite: "auto",
                            clearProps,
                            onComplete: () => {
                                // A breakpoint change can revert an unfinished reveal.
                                element.dataset.revealed = "true";
                            },
                        });
                    });
                }
            });

            ScrollTrigger.batch(targets, {
                // A negative start lets already visible blocks enter at scrollY 0.
                start: "top 92%",
                interval: 0.08,
                batchMax: 4,
                once: true,
                onEnter: (batch) => context.reveal(batch),
                onEnterBack: (batch) => context.reveal(batch),
            });

            if (scrollY < innerHeight && !headerRevealed) {
                headerRevealed = true;
                gsap.from(".header", {
                    opacity: 0,
                    duration: 0.45,
                    clearProps: "opacity",
                });
            }

            const onFocus = (event) => {
                if (!event.target.matches(":focus-visible")) return;
                const target = event.target.closest("[data-reveal]");
                if (target && targets.includes(target))
                    context.reveal([target], true);
            };
            document.addEventListener("focusin", onFocus);

            // Accordion heights and late-loaded media can move later sections.
            let refreshTimer;
            const refresh = () => {
                clearTimeout(refreshTimer);
                refreshTimer = setTimeout(() => {
                    if (!context.isReverted) ScrollTrigger.refresh();
                }, 120);
            };
            const observer = new ResizeObserver(refresh);
            observer.observe(document.querySelector(".page__main, .page__home"));
            const images = Array.from(document.images).filter(
                (image) => !image.complete,
            );
            images.forEach((image) => image.addEventListener("load", refresh));
            document.fonts.ready.then(refresh);
            window.addEventListener("load", refresh, { once: true });

            return () => {
                observer.disconnect();
                clearTimeout(refreshTimer);
                document.removeEventListener("focusin", onFocus);
                window.removeEventListener("load", refresh);
                images.forEach((image) =>
                    image.removeEventListener("load", refresh),
                );
            };
        },
    );
}

initPageReveal();

// Both reveal curves use vertical control points at 1.
function heroBezierEase(firstX, secondX) {
    return (progress) => {
        if (progress === 0 || progress === 1) return progress;
        let low = 0;
        let high = 1;
        for (let index = 0; index < 24; index++) {
            const t = (low + high) / 2;
            const x = 3 * (1 - t) ** 2 * t * firstX +
                3 * (1 - t) * t ** 2 * secondX + t ** 3;
            if (x < progress) low = t;
            else high = t;
        }
        return 1 - (1 - (low + high) / 2) ** 3;
    };
}

// Hero — reproduce the inspected reference, including its exact Bezier curve.
function initHeroTextMotion() {
    const element = document.querySelector(".hero-slider");
    if (!element?.hasAttribute("aria-busy") || !window.gsap) return;
    const slider = element.swiper;

    const controls = Array.from(
        document.querySelectorAll(".hero-slider__arrow"),
    );
    const referenceEase = heroBezierEase(0.16, 0.3);
    const lock = (locked) => {
        element.setAttribute(
            "aria-busy",
            String(locked || !element.hasAttribute("data-slider-ready")),
        );
        controls.forEach((button) => {
            button.disabled = false;
            button.setAttribute("aria-disabled", "false");
        });
    };
    const media = gsap.matchMedia();
    media.add(
        "(prefers-reduced-motion: no-preference)",
        (context) => {
            let timeline;
            let title;
            let text;
            let cta;
            let secondary = [];
            let ready = false;
            let active = true;
            const restore = () => {
                if (text)
                    gsap.set([text, ...secondary, cta], {
                        clearProps: "opacity,transform",
                    });
                title?.classList.remove("hero-slider__title--revealing");
            };
            const prepare = () => {
                timeline?.kill();
                restore();
                const frame = slider ? slider.slides[slider.activeIndex] : element;
                title = frame.querySelector(".hero-slider__title");
                text = frame.querySelector(".hero-slider__title-text");
                cta = frame.querySelector(".hero-slider__link");
                secondary = [
                    ".hero-slider__wordmark",
                    ".hero-slider__emphasis",
                    ".hero-slider__text",
                ].map((selector) => frame.querySelector(selector));
                const extra = frame.querySelector(".hero-slider__stage, .hero-slider__note");
                if (extra) secondary.push(extra);
                title.classList.add("hero-slider__title--revealing");
                gsap.set(text, { yPercent: 110, opacity: 0 });
                gsap.set([...secondary, cta], { y: 16, opacity: 0 });
                lock(true);
            };
            context.add("playHero", () => {
                prepare();
                if (!ready) return;
                // One timeline owns title, supporting text and the requested CTA.
                timeline = gsap.timeline({
                    onComplete: () => {
                        restore();
                        lock(false);
                    },
                });
                timeline
                    .to(
                        text,
                        {
                            yPercent: 0,
                            opacity: 1,
                            duration: 1,
                            ease: referenceEase,
                        },
                        0.1,
                    )
                    .to(
                        secondary,
                        {
                            y: 0,
                            opacity: 1,
                            duration: 0.9,
                            ease: referenceEase,
                        },
                        0.5,
                    )
                    .to(
                        cta,
                        {
                            y: 0,
                            opacity: 1,
                            duration: 0.75,
                            ease: referenceEase,
                        },
                        0.65,
                    );
            });
            const onChange = () => context.playHero();
            slider?.on("slideChangeTransitionStart", onChange);
            context.playHero();
            Promise.all([document.fonts.ready, heroImageReady]).then(() => {
                if (!active || slider?.destroyed) return;
                ready = true;
                context.playHero();
            });

            // Keyboard focus must never land on transparent supporting text.
            const onFocus = (event) => {
                if (
                    [...secondary, cta].some((item) =>
                        item.contains(event.target),
                    )
                ) {
                    timeline?.progress(1);
                }
            };
            element.addEventListener("focusin", onFocus);
            return () => {
                active = false;
                timeline?.kill();
                title?.classList.remove("hero-slider__title--revealing");
                slider?.off("slideChangeTransitionStart", onChange);
                element.removeEventListener("focusin", onFocus);
                lock(false);
            };
        },
    );
}

initHeroTextMotion();
