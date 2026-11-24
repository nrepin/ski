"use strict";

// Wait for the banner image or the first active slide image.
function initMediaLoading(element, slider) {
    let controller;
    let finished = false;
    let resolveReady;
    delete element.dataset.sliderReady;
    element.setAttribute("aria-busy", "true");
    const ready = new Promise((resolve) => {
        resolveReady = resolve;
    });
    const finish = (state) => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        controller?.abort();
        slider?.off("activeIndexChange", checkActiveImage);
        slider?.off("destroy", onDestroy);
        element.dataset.sliderReady = state;
        element.setAttribute("aria-busy", "false");
        resolveReady();
    };
    const onDestroy = () => finish("unavailable");
    const checkActiveImage = () => {
        controller?.abort();
        controller = new AbortController();
        const { signal } = controller;
        const frame = slider ? slider.slides[slider.activeIndex] : element;
        const image = frame?.querySelector(".hero-slider__skier, .race-photos__image");
        const backdrop = frame?.querySelector(".hero-slider__backdrop");
        if (!image) {
            finish("ready");
            return;
        }
        const loaded = async () => {
            if (signal.aborted || finished) return;
            if (!image.naturalWidth) {
                finish("error");
                return;
            }
            try {
                await Promise.allSettled([image.decode?.(), backdrop?.decode?.()]);
            } catch {
                // A decoded frame is optional; a valid loaded image still works.
            }
            if (!signal.aborted) finish("ready");
        };
        image.addEventListener("load", loaded, { once: true, signal });
        image.addEventListener("error", () => finish("error"), { once: true, signal });
        // Promote only the actual first visible image if it was marked lazy.
        image.loading = "eager";
        if (backdrop) backdrop.loading = "eager";
        if (image.complete) loaded();
    };
    // Network-stall fallback, never a minimum display time or simulated loading.
    const deadline = setTimeout(() => finish("timeout"), 15000);
    slider?.on("activeIndexChange", checkActiveImage);
    slider?.on("destroy", onDestroy);
    checkActiveImage();
    return ready;
}

function initSliderLoading(slider) {
    slider.loadingReady = initMediaLoading(slider.el, slider);
}

// Owners prevent one dialog from unlocking another during a handoff.
const scrollLock = (() => {
    const owners = new Set();
    let saved;
    return {
        lock(owner) {
            if (owners.has(owner)) return;
            const element = document.documentElement;
            if (!owners.size) {
                saved = {
                    overflow: element.style.overflow,
                    bodyWidth: document.body.style.width,
                };
                const gap = window.innerWidth - element.clientWidth;
                if (gap > 0) {
                    // Keep the page's width while top-layer dialogs use the full viewport.
                    document.body.style.width = `calc(100vw - ${gap}px)`;
                    document.body.style.setProperty("--scroll-lock-gap", `${gap}px`);
                }
                element.style.overflow = "hidden";
            }
            owners.add(owner);
        },
        unlock(owner) {
            if (!owners.delete(owner) || owners.size) return;
            document.documentElement.style.overflow = saved.overflow;
            document.body.style.width = saved.bodyWidth;
            document.body.style.removeProperty("--scroll-lock-gap");
        },
    };
})();

function updateHeroCorner() {
    const hero = document.querySelector(".hero");
    if (!hero) return;
    const radius = matchMedia("(width < 768px)").matches
        ? 0
        : 42 * Math.max(1, hero.getBoundingClientRect().width / 1342);
    hero.style.setProperty("--hero-radius", `${radius}px`);
    const main = document.querySelector(".page__main");
    if (main) {
        document.documentElement.style.setProperty(
            "--page-decor-offset",
            `${-(main.getBoundingClientRect().top + scrollY)}px`,
        );
    }
}

function initHeroStagePicker(slider, stages) {
    const drum = document.querySelector(".hero-stages__drum");
    if (!drum) return;

    const current = drum.querySelector(".hero-stages__current");
    const controls = Array.from(drum.querySelectorAll("[data-hero-stage]"));
    const count = stages.length;
    const renderControls = (index) => {
        const focused = controls.indexOf(document.activeElement);
        const focusedStage = focused >= 0 ? Number(controls[focused].dataset.heroStage) : null;
        current.querySelector(".hero-stages__digit").textContent = stages[index];
        controls.forEach((button, slot) => {
            const nextIndex = (index + slot + 1) % count;
            const number = stages[nextIndex];
            button.dataset.heroStage = nextIndex;
            button.querySelector(".hero-stages__digit").textContent = number;
            button.setAttribute("aria-label", `${number} этап`);
        });
        if (focusedStage !== null) {
            const offset = (focusedStage - index + count) % count;
            (offset ? controls[offset - 1] : current).focus({ preventScroll: true });
        }
    };
    controls.forEach((button) => {
        button.disabled = false;
        button.addEventListener("click", () => {
            slider.slideToLoop(Number(button.dataset.heroStage));
        });
    });
    slider.on("realIndexChange", () => renderControls(slider.realIndex));

    if (!window.gsap) return;
    const mask = document.createElement("div");
    mask.className = "hero-stages__mask";
    mask.setAttribute("aria-hidden", "true");
    const reel = document.createElement("div");
    reel.className = "hero-stages__reel";
    for (const stage of [...stages, ...stages]) {
        const digit = document.createElement("span");
        digit.className = "hero-stages__reel-digit";
        digit.textContent = stage;
        reel.append(digit);
    }
    mask.append(reel);
    drum.append(mask);

    const position = { row: slider.realIndex };
    const wrapRow = gsap.utils.wrap(0, count);
    const setOffset = gsap.quickSetter(reel, "yPercent");
    const draw = () => setOffset(-100 * wrapRow(position.row) / (2 * count));
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    let targetRow = slider.realIndex;
    const settle = () => {
        targetRow = slider.realIndex;
        position.row = targetRow;
        draw();
        drum.classList.remove("hero-stages__drum--rolling");
    };
    let tween;
    slider.on("realIndexChange", () => {
        tween?.kill();
        if (preference.matches) {
            settle();
            return;
        }
        // Select the direction from the logical steps, even during an interrupted roll.
        const forward = wrapRow(slider.realIndex - targetRow);
        const step = forward > count / 2 ? forward - count : forward;
        targetRow += step;
        drum.classList.add("hero-stages__drum--rolling");
        tween = gsap.to(position, {
            row: targetRow,
            duration: 0.48 + 0.08 * Math.abs(step),
            ease: "power2.out",
            onUpdate: draw,
            onComplete: settle,
        });
    });
    preference.addEventListener("change", () => {
        tween?.kill();
        settle();
    });
    draw();
}

function initHero() {
    const element = document.querySelector(".hero-slider");
    if (!element) return;
    updateHeroCorner();
    if (!element.classList.contains("swiper") || typeof Swiper === "undefined") {
        return initMediaLoading(element);
    }
    const track = element.querySelector(".swiper-wrapper");
    const stages = Array.from(track.children, (slide) => {
        slide.hidden = false;
        return Number(slide.dataset.stageNumber);
    });
    const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
    const slideSpeed = 300;
    const slider = new Swiper(element, {
        slidesPerView: 1,
        loop: true,
        speed: motionPreference.matches ? 0 : slideSpeed,
        preventInteractionOnTransition: false,
        loopPreventsSliding: false,
        navigation: {
            prevEl: ".hero-slider__prev",
            nextEl: ".hero-slider__next",
        },
        a11y: { enabled: true },
        on: { init: initSliderLoading },
    });
    motionPreference.addEventListener("change", ({ matches }) => {
        slider.params.speed = matches ? 0 : slideSpeed;
    });
    initHeroStagePicker(slider, stages);
    element.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "ArrowLeft" && !slider.allowSlidePrev) return;
        if (event.key === "ArrowRight" && !slider.allowSlideNext) return;
        if (event.key === "ArrowLeft") slider.slidePrev();
        else slider.slideNext();
    });
    return slider.loadingReady;
}
const heroImageReady = initHero();

// The menu and media dialog share the page scroll lock.
const headerMenuToggle = document.querySelector(".header__menu-toggle");
const slidingFooter = document.querySelector(".sliding-footer");
const slidingMenuToggle = slidingFooter.querySelector("[data-menu-toggle]");
const pageHeader = headerMenuToggle.closest(".header");
const pageFooter = document.querySelector(".page__footer");
const menu = document.querySelector("#menu");
const viewer = document.querySelector("#viewer");
const viewerContent = document.querySelector("#dialog-content");
const desktopViewport = matchMedia("(min-width: 768px)");
let menuToggle = headerMenuToggle;

// Sliding Footer
function isInViewport(element) {
    const { top, bottom } = element.getBoundingClientRect();
    return bottom >= 0 && top <= document.documentElement.clientHeight;
}

function focusMenuOpener(opener) {
    const target = opener === slidingMenuToggle && slidingFooter.inert
        ? (isInViewport(pageFooter) ? pageFooter : headerMenuToggle)
        : opener;
    target.focus({ preventScroll: true });
}

function updateSlidingFooter() {
    // Keep the animation origin in place until the shared dialog finishes closing.
    if (desktopViewport.matches && menu.open && menuToggle === slidingMenuToggle) return;
    const visible = desktopViewport.matches && !isInViewport(pageHeader);
    const restoreFocus = !visible && slidingFooter.contains(document.activeElement);
    slidingFooter.classList.toggle("sliding-footer--visible", visible);
    slidingFooter.inert = !visible;
    if (restoreFocus) focusMenuOpener(slidingMenuToggle);
}

const slidingFooterObserver = new IntersectionObserver(updateSlidingFooter);
slidingFooterObserver.observe(pageHeader);

function positionBurgerMenu() {
    const hero = document.querySelector(".hero");
    if (menuToggle === slidingMenuToggle && !desktopViewport.matches) return;
    const trigger = menuToggle.getBoundingClientRect();
    const mobile = !desktopViewport.matches;
    let left = 0;
    let top = 0;
    const border = mobile ? 0 : 2;
    if (!mobile) {
        const bounds = hero.getBoundingClientRect();
        const width = Math.min(543, bounds.width);
        const cornerScale = Math.max(1, bounds.width / 1342);
        const radius = 37 * cornerScale;
        // Keep the entire trigger inside the rounded corner, with the close
        // control still centred exactly over it. Its box must not overflow.
        const padding = Math.max(12, radius - trigger.width / 2 + border);
        const right = Math.min(innerWidth, trigger.right + padding);
        left = Math.max(0, right - width);
        top = Math.max(0, Math.min(trigger.top - padding, innerHeight - 44));
        top = Math.min(top + 10, Math.max(0, innerHeight - 44));
        // Panel typography stays fixed; its corner still follows the Hero scale.
        menu.style.setProperty("--menu-radius", `${radius}px`);
        menu.style.setProperty("--menu-width", `${width}px`);
        menu.style.setProperty("--menu-left", `${left}px`);
        menu.style.setProperty("--menu-top", `${top}px`);
    }
    // The close control occupies the exact viewport rectangle of the trigger.
    menu.style.setProperty(
        "--menu-close-left",
        `${trigger.left - left - border}px`,
    );
    menu.style.setProperty(
        "--menu-close-top",
        `${trigger.top - top - border}px`,
    );
    menu.style.setProperty("--menu-close-size", `${trigger.width}px`);
}

new ResizeObserver(() => {
    updateHeroCorner();
    if (menu.open) positionBurgerMenu();
}).observe(document.querySelector(".hero"));
window.addEventListener("resize", () => {
    if (menu.open) positionBurgerMenu();
});

// Burger Menu — reversible orchestration, with a separate exit ease per tween.
let menuAnimation;
let menuClosing = false;
let menuNavigation = null;
const menuMotionPreference = matchMedia("(prefers-reduced-motion: reduce)");
const menuMotionItems = Array.from(
    menu.querySelectorAll(
        ".burger-menu__brand, .burger-menu__link, .burger-menu__contacts, .burger-menu__social",
    ),
);

function clearMenuMotion() {
    menu.classList.remove("burger-menu--animating");
    menu.style.removeProperty("clip-path");
    menuMotionItems.forEach((item) => {
        for (const property of [
            "transform",
            "opacity",
            "visibility",
            "translate",
            "rotate",
            "scale",
        ]) {
            item.style.removeProperty(property);
        }
    });
}

function finishMenuClose() {
    menuAnimation?.kill();
    menuAnimation = null;
    menuClosing = false;
    clearMenuMotion();
    if (menu.open) menu.close();
}

function createMenuAnimation() {
    const items = menuMotionItems.filter(
        (item) => item.getClientRects().length,
    );
    const panel = menu.getBoundingClientRect();
    const trigger = menuToggle.getBoundingClientRect();
    const origin = {
        top: trigger.top - panel.top,
        right: panel.right - trigger.right,
        bottom: panel.bottom - trigger.bottom,
        left: trigger.left - panel.left,
    };
    const radius = getComputedStyle(menu).borderTopRightRadius;
    return gsap
        .timeline({
            paused: true,
            onComplete: clearMenuMotion,
            onReverseComplete: finishMenuClose,
        })
        .fromTo(
            menu,
            {
                clipPath: `inset(${origin.top}px ${origin.right}px ${origin.bottom}px ${origin.left}px round ${trigger.width / 2}px)`,
            },
            {
                clipPath: `inset(0px 0px 0px 0px round ${radius})`,
                duration: 0.55,
                ease: "power3.out",
                easeReverse: "power2.inOut",
            },
            0,
        )
        .fromTo(
            items,
            {
                y: 18,
                autoAlpha: 0,
            },
            {
                y: 0,
                autoAlpha: 1,
                duration: 0.4,
                stagger: 0.04,
                ease: "power3.out",
                easeReverse: "power2.in",
            },
            0.12,
        );
}

function setMenuOpen(open, opener = menuToggle) {
    const animate = window.gsap && !menuMotionPreference.matches &&
        (desktopViewport.matches || opener !== slidingMenuToggle);
    if (open) {
        if (!menu.open) menuToggle = opener;
        if (menuToggle === slidingMenuToggle) {
            // Settle the entrance so the dialog and its close button use one origin.
            slidingFooter.getAnimations().forEach((animation) => animation.finish());
        }
        menuNavigation = null;
        if (viewer?.open) closeViewer();
        scrollLock.lock(menu);
        positionBurgerMenu();
        if (!menu.open) {
            menu.showModal();
            menu.scrollTop = 0;
            menuAnimation?.kill();
            menuAnimation = animate ? createMenuAnimation() : null;
        }
        menuClosing = false;
        if (menuAnimation && animate) {
            menu.classList.add("burger-menu--animating");
            menuAnimation.play();
        }
    } else if (menu.open) {
        menuClosing = true;
        // Re-measure the trigger after a resize before a complete exit.
        if (menuAnimation && animate && menuAnimation.progress() === 1) {
            menuAnimation.kill();
            menuAnimation = createMenuAnimation();
            menuAnimation.progress(1);
        }
        if (menuAnimation && animate && menuAnimation.time() > 0) {
            menu.classList.add("burger-menu--animating");
            menuAnimation.reverse();
        } else {
            finishMenuClose();
        }
    }
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute(
        "aria-label",
        open ? "Закрыть меню" : "Открыть меню",
    );
}
menuMotionPreference.addEventListener("change", () => {
    if (!menuMotionPreference.matches || !menuAnimation) return;
    if (menuClosing) finishMenuClose();
    else {
        menuAnimation.progress(1);
        menuAnimation.kill();
        menuAnimation = null;
        clearMenuMotion();
    }
});
menu.addEventListener("focusin", (event) => {
    if (
        !menuClosing &&
        menuAnimation?.isActive() &&
        menuMotionItems.some((item) => item.contains(event.target))
    ) {
        menuAnimation.progress(1);
    }
});
desktopViewport.addEventListener("change", () => {
    setMenuOpen(false);
    updateSlidingFooter();
});
document.querySelectorAll("[data-menu-toggle]").forEach((button) => {
    button.addEventListener("click", () => setMenuOpen(!menu.open, button));
});
menu.querySelector(".burger-menu__close").addEventListener("click", () =>
    setMenuOpen(false),
);
menu.addEventListener("cancel", (event) => {
    event.preventDefault();
    setMenuOpen(false);
});
menu.addEventListener("close", () => {
    if (menu.open) return;
    menuAnimation?.kill();
    menuAnimation = null;
    menuClosing = false;
    clearMenuMotion();
    scrollLock.unlock(menu);
    const opener = menuToggle;
    opener.setAttribute("aria-expanded", "false");
    opener.setAttribute("aria-label", "Открыть меню");
    menuToggle = headerMenuToggle;
    updateSlidingFooter();
    if (!viewer?.open) focusMenuOpener(opener);
    const navigate = menuNavigation;
    menuNavigation = null;
    navigate?.();
});
menu.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (link) {
        const href = link.getAttribute("href");
        const local = /^(?:#|(?:index|stage[1-3])\.html(?:#|$))/.test(href);
        const modified = event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
        if (local && !modified && !link.target) {
            event.preventDefault();
            menuNavigation = () => {
                const samePage = link.pathname === location.pathname &&
                    (href.startsWith("#") || link.search === location.search);
                const target = samePage && link.hash &&
                    document.getElementById(decodeURIComponent(link.hash.slice(1)));
                if (!target) {
                    location.assign(link.href);
                    return;
                }
                if (link.hash === "#number-pickup") setAccordionOpen(target, true);
                history.pushState(null, "", link.hash);
                target.scrollIntoView({
                    behavior: menuMotionPreference.matches ? "instant" : "smooth",
                    block: "start",
                });
            };
        }
        setMenuOpen(false);
    }
    if (event.target === menu) {
        const r = menu.getBoundingClientRect();
        if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
        )
            setMenuOpen(false);
    }
});
let gallerySlider;
let thumbnailSlider;
let galleryResizeObserver;
let viewerOpener;
let viewerAnimation;
let viewerClosing = false;

function closeViewer() {
    if (!viewer.open || viewerClosing) return;
    viewerClosing = true;
    viewerContent.querySelector(".video-player__frame")?.pause();
    const opacity = getComputedStyle(viewer).opacity;
    viewerAnimation?.cancel();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        viewer.close();
        return;
    }
    viewer.classList.add("media-dialog--closing");
    const animation = viewer.animate([{ opacity }, { opacity: 0 }], {
        duration: 160,
        easing: "ease-in",
        fill: "forwards",
    });
    viewerAnimation = animation;
    animation.finished
        .then(() => {
            if (viewerAnimation === animation && viewer.open) viewer.close();
        })
        .catch(() => {});
}

viewer?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeViewer();
});

function openViewer(opener = document.activeElement) {
    if (menu.open) setMenuOpen(false);
    viewerOpener = opener;
    scrollLock.lock(viewer);
    viewer.showModal();
    viewerClosing = false;
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
        viewerAnimation = viewer.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 200,
            easing: "ease-out",
        });
    }
}
viewer?.addEventListener("close", () => {
    viewerAnimation?.cancel();
    viewerAnimation = null;
    viewerClosing = false;
    viewer.classList.remove("media-dialog--closing");
    const closeButton = viewer.querySelector(".media-dialog__close");
    viewer.insertBefore(closeButton, viewerContent);
    closeButton.classList.remove(
        "gallery__close",
        "media-dialog__close--video",
    );
    gallerySlider?.destroy();
    gallerySlider = null;
    galleryResizeObserver?.disconnect();
    galleryResizeObserver = null;
    thumbnailSlider?.destroy();
    thumbnailSlider = null;
    photoSlider?.keyboard?.enable();
    const video = viewerContent.querySelector(".video-player__frame");
    if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
    }
    viewerContent.replaceChildren();
    scrollLock.unlock(viewer);
    viewer.removeAttribute("data-mode");
    // Growing the ribbon buffer during a popup resize replaces its buttons.
    // Return focus to the nearest instance of the same logical photo.
    if (
        viewerOpener &&
        !viewerOpener.isConnected &&
        viewerOpener.dataset.photoIndex !== undefined
    ) {
        const index = viewerOpener.dataset.photoIndex;
        const candidates = Array.from(
            photoElement.querySelectorAll(`[data-photo-index="${index}"]`),
        );
        candidates.sort((a, b) => {
            const centerDistance = (element) => {
                const box = element.getBoundingClientRect();
                return Math.abs(box.left + box.width / 2 - innerWidth / 2);
            };
            return centerDistance(a) - centerDistance(b);
        });
        viewerOpener = candidates[0];
    }
    if (!menu.open) viewerOpener?.focus({ preventScroll: true });
});

document.addEventListener("click", (event) => {
    if (!viewer) return;
    const button = event.target.closest("[data-image]");
    if (!button) return;
    if (button.closest(".race-photos")) {
        if (photoSlider && !photoSlider.allowClick) return;
        openGallery(Number(button.dataset.photoIndex), button);
        return;
    }
    viewer.dataset.mode = "image";
    viewer.setAttribute("aria-label", "Схема трасс");
    const image = new Image();
    image.className = "media-dialog__image";
    image.src = button.dataset.image;
    image.alt = button.querySelector(".map-preview__image").alt;
    viewerContent.replaceChildren(image);
    openViewer(button);
});
viewer
    ?.querySelector(".media-dialog__close")
    .addEventListener("click", () => closeViewer());
viewer?.addEventListener("click", (event) => {
    if (event.target !== viewer) return;
    const bounds = viewer.getBoundingClientRect();
    if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
    )
        closeViewer();
});
document.querySelector("[data-video]")?.addEventListener("click", (event) => {
    const opener = event.currentTarget;
    const title = "Видео лыжной гонки";
    viewer.dataset.mode = "video";
    viewer
        .querySelector(".media-dialog__close")
        .classList.add("media-dialog__close--video");
    viewer.setAttribute("aria-label", title);
    const player = document.createElement("div");
    player.className = "video-player";
    const video = document.createElement("video");
    video.className = "video-player__frame";
    video.setAttribute("aria-label", title);
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;

    const status = document.createElement("p");
    status.className = "video-player__status video-player__status--loading";
    status.setAttribute("role", "status");
    status.textContent = "Загрузка видео…";

    const hideLoading = () => {
        status.hidden = true;
    };
    video.addEventListener("loadeddata", hideLoading, { once: true });
    video.addEventListener("playing", hideLoading, { once: true });
    video.addEventListener("error", () => {
        status.classList.remove("video-player__status--loading");
        status.textContent = "Не удалось загрузить видео";
        status.hidden = false;
    }, { once: true });

    player.append(video, status);
    viewerContent.replaceChildren(player);
    openViewer(opener);
    video.src = opener.dataset.video;
});

const galleryPhotos = Array.from(
    document.querySelectorAll(".race-photos [data-photo-index]"),
    (button) => {
        const thumbnail = button.querySelector(".race-photos__image");
        return {
            src: button.dataset.image,
            thumbnailSrc: thumbnail.src,
            alt: thumbnail.alt,
        };
    },
);
function openGallery(index, opener) {
    viewer.dataset.mode = "gallery";
    viewer.setAttribute("aria-label", "Фотогалерея гонки Уралхим Ski Factory");
    const main = document.createElement("div");
    main.className = "swiper gallery__main";
    const mainTrack = document.createElement("div");
    mainTrack.className = "swiper-wrapper";
    const thumbs = document.createElement("div");
    thumbs.className = "swiper gallery__thumbs";
    thumbs.setAttribute("aria-label", "Выбор фотографии");
    const thumbTrack = document.createElement("div");
    thumbTrack.className = "swiper-wrapper";
    const status = document.createElement("p");
    status.className = "sr-only";
    status.setAttribute("aria-live", "polite");
    const mainCount =
        Math.ceil(Math.max(6, galleryPhotos.length) / galleryPhotos.length) *
        galleryPhotos.length;
    const thumbWidth = desktopViewport.matches ? 145.694 : 78.984;
    const thumbCount =
        Math.ceil(
            (2 * Math.ceil(innerWidth / thumbWidth) + 4) / galleryPhotos.length,
        ) * galleryPhotos.length;
    for (let j = 0; j < Math.max(mainCount, thumbCount); j++) {
        const i = j % galleryPhotos.length;
        const photo = galleryPhotos[i];
        const slide = document.createElement("div");
        slide.className = "swiper-slide gallery__slide";
        slide.dataset.photoIndex = i;
        const image = new Image();
        image.className = "gallery__image";
        image.src = photo.src;
        image.alt = photo.alt;
        image.decoding = "async";
        slide.append(image);
        if (j < mainCount) mainTrack.append(slide);
        const thumbSlide = document.createElement("div");
        thumbSlide.className = "swiper-slide gallery__thumbnail-slide";
        thumbSlide.dataset.photoIndex = i;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "gallery__thumb";
        button.setAttribute("aria-label", "Открыть фотографию " + (i + 1));
        const thumb = new Image();
        thumb.className = "gallery__thumbnail";
        thumb.src = photo.thumbnailSrc;
        thumb.alt = "";
        button.append(thumb);
        thumbSlide.append(button);
        thumbTrack.append(thumbSlide);
    }
    main.append(mainTrack);
    thumbs.append(thumbTrack);
    const stage = document.createElement("div");
    stage.className = "gallery__stage";
    stage.append(main);
    const closeButton = viewer.querySelector(".media-dialog__close");
    closeButton.classList.add("gallery__close");
    stage.prepend(closeButton);
    const prev = document.createElement("button");
    prev.className = "gallery__arrow gallery__prev";
    prev.append(document.getElementById("gallery-arrow-prev-icon").content.firstElementChild.cloneNode(true));
    prev.setAttribute("aria-label", "Предыдущая фотография");
    const next = document.createElement("button");
    next.className = "gallery__arrow gallery__next";
    next.append(document.getElementById("gallery-arrow-next-icon").content.firstElementChild.cloneNode(true));
    next.setAttribute("aria-label", "Следующая фотография");
    const controls = document.createElement("div");
    controls.className = "gallery__arrows";
    controls.append(prev, next);
    stage.append(controls);
    viewerContent.replaceChildren(stage, thumbs, status);
    openViewer(opener);
    photoSlider?.keyboard?.disable();
    const thumbTemplates = galleryPhotos.map((photo, i) =>
        thumbTrack.querySelector(`[data-photo-index="${i}"]`).cloneNode(true),
    );
    thumbs.addEventListener("click", (event) => {
        const slide = event.target.closest(".swiper-slide[data-photo-index]");
        if (slide)
            slideToLogicalPhoto(
                gallerySlider,
                Number(slide.dataset.photoIndex),
            );
    });
    const createThumbnailSlider = (initialSlide) =>
        new Swiper(thumbs, {
            slidesPerView: "auto",
            spaceBetween: 4.9493,
            centeredSlides: true,
            initialSlide,
            loop: true,
            speed: 0,
            grabCursor: true,
            resizeObserver: false,
            updateOnWindowResize: false,
            breakpoints: { 768: { spaceBetween: 3.7843 } },
            a11y: { enabled: true, slideLabelMessage: "Миниатюра фотографии" },
        });
    thumbnailSlider = createThumbnailSlider(index);
    const sync = () => {
        const i = gallerySlider.realIndex % galleryPhotos.length;
        status.textContent =
            "Фотография " + (i + 1) + " из " + galleryPhotos.length;
        thumbTrack
            .querySelectorAll(".gallery__thumb")
            .forEach((button) =>
                button.setAttribute(
                    "aria-current",
                    String(
                        i ===
                            Number(
                                button.closest(".swiper-slide").dataset
                                    .photoIndex,
                            ),
                    ),
                ),
            );
        slideToLogicalPhoto(thumbnailSlider, i);
    };
    gallerySlider = new Swiper(main, {
        initialSlide: index,
        slidesPerView: 1,
        slidesPerGroup: 1,
        spaceBetween: 0,
        loop: true,
        speed: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200,
        grabCursor: true,
        simulateTouch: true,
        keyboard: { enabled: true, onlyInViewport: false },
        navigation: { prevEl: prev, nextEl: next },
        a11y: {
            slideLabelMessage: "Фотография",
            prevSlideMessage: "Предыдущая фотография",
            nextSlideMessage: "Следующая фотография",
        },
        on: {
            slideChange: () => {
                if (gallerySlider) sync();
            },
        },
    });
    sync();
    galleryResizeObserver = new ResizeObserver(() => {
        const width = desktopViewport.matches ? 145.694 : 78.984;
        const minimum = 2 * (Math.ceil(thumbs.clientWidth / width) + 2);
        if (thumbTrack.children.length >= minimum) {
            thumbnailSlider.update();
            return;
        }
        const current = gallerySlider.realIndex % galleryPhotos.length;
        thumbnailSlider.destroy(true, true);
        thumbTrack.replaceChildren();
        const count =
            Math.ceil(minimum / galleryPhotos.length) * galleryPhotos.length;
        for (let i = 0; i < count; i++) {
            thumbTrack.append(
                thumbTemplates[i % galleryPhotos.length].cloneNode(true),
            );
        }
        thumbnailSlider = createThumbnailSlider(current);
        sync();
    });
    galleryResizeObserver.observe(thumbs);
}

function slideToLogicalPhoto(slider, index) {
    if (!slider) return;
    const count = slider.slides.length;
    const distance = (position) => {
        const delta = Math.abs(position - slider.realIndex);
        return Math.min(delta, count - delta);
    };
    const candidates = Array.from(slider.slides)
        .filter((slide) => Number(slide.dataset.photoIndex) === index)
        .map((slide) => Number(slide.dataset.swiperSlideIndex));
    const closest = candidates.reduce((best, value) =>
        distance(value) < distance(best) ? value : best,
    );
    slider.slideToLoop(closest);
}

// Independent panels; text switches immediately, only the map fades.
const routeButtons = Array.from(document.querySelectorAll("[data-route]"));
const routeTemplate = document.querySelector(".routes__panel");
routeButtons.forEach((button, index) => {
    const panel = index === 0 ? routeTemplate : routeTemplate.cloneNode(true);
    const { route, routeMap, routeDescription, routeLaps, routeTurns, routeDifficulty } = button.dataset;
    if (index !== 0) {
        panel.id = button.getAttribute("aria-controls");
        panel.setAttribute("aria-labelledby", button.id);
        panel.hidden = true;
        panel.querySelector(".routes__text").textContent = routeDescription.trim();
        panel.querySelector(".stats-icon__em").textContent = `×${routeLaps}`;
        panel.querySelector(".route-stats__emphasis--laps").textContent =
            `${routeLaps} ${routeLaps === "1" ? "круг" : "круга"}`;
        panel.querySelector(".route-stats__emphasis--turns").textContent = routeTurns;
        panel.querySelector(".route-stats__emphasis--difficulty").textContent = routeDifficulty;
    }
    const preview = panel.querySelector(".map-preview");
    const image = preview.querySelector(".map-preview__image");
    preview.dataset.image = routeMap;
    image.src = routeMap;
    image.alt = `Схема трассы на ${route}`;
    if (index !== 0) routeTemplate.parentElement.append(panel);
});
let routeMapAnimation;
let routeMapVersion = 0;
async function revealRouteMap(panel) {
    const version = ++routeMapVersion;
    routeMapAnimation?.cancel();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const image = panel.querySelector(".map-preview__image");
    const animation = image.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 350,
        easing: "ease-out",
    });
    routeMapAnimation = animation;
    animation.pause();
    try {
        await image.decode?.();
    } catch {
        // The error fallback must also become visible.
    }
    if (version !== routeMapVersion || panel.hidden) return;
    animation.onfinish = () => animation.cancel();
    animation.play();
}
function selectRoute(button) {
    if (button.getAttribute("aria-selected") === "true") return;
    routeButtons.forEach((tab) => {
        const selected = tab === button;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
    });
    revealRouteMap(document.getElementById(button.getAttribute("aria-controls")));
}
routeButtons.forEach((button, index) => {
    button.addEventListener("click", () => selectRoute(button));
    button.addEventListener("keydown", (event) => {
        const offsets = {
            ArrowRight: 1,
            ArrowLeft: -1,
            Home: -index,
            End: routeButtons.length - 1 - index,
        };
        if (!(event.key in offsets)) return;
        event.preventDefault();
        const next =
            routeButtons[
                (index + offsets[event.key] + routeButtons.length) %
                    routeButtons.length
            ];
        selectRoute(next);
        next.focus();
    });
});

// Animate the actual disclosure height, including interrupted transitions.
const accordionAnimations = new WeakMap();
function setAccordionOpen(details, expanded) {
    const trigger = details.querySelector(".information-panel__summary");
    const content = details.querySelector(".information-panel__content");
    const previous = accordionAnimations.get(details);
    const from = details.open ? content.getBoundingClientRect().height : 0;
    previous?.cancel();
    details.open = true;
    trigger.setAttribute("aria-expanded", String(expanded));
    content.inert = !expanded;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        details.open = expanded;
        content.style.height = "";
        return;
    }
    content.style.height = "auto";
    const to = expanded ? content.scrollHeight : 0;
    const animation = content.animate(
        [{ height: `${from}px` }, { height: `${to}px` }],
        {
            duration: 280,
            easing: "ease-in-out",
        },
    );
    accordionAnimations.set(details, animation);
    animation.onfinish = () => {
        if (accordionAnimations.get(details) !== animation) return;
        details.open = expanded;
        animation.cancel();
        accordionAnimations.delete(details);
    };
}
document.querySelectorAll(".information-panel__details").forEach((details) => {
    const trigger = details.querySelector(".information-panel__summary");
    if (location.hash === `#${details.id}`) setAccordionOpen(details, true);
    trigger.addEventListener("click", (event) => {
        event.preventDefault();
        setAccordionOpen(
            details,
            trigger.getAttribute("aria-expanded") !== "true",
        );
    });
});

// Build repetitions before Swiper initialization. Each duplicate points to an
// existing resource and retains the logical index used by the popup/counter.
let photoSlider;
const photoElement = document.querySelector(".race-photos");
const photoTrack = photoElement?.querySelector(".swiper-wrapper");
const photoTemplates = Array.from(photoTrack?.children ?? [], (slide) =>
    slide.cloneNode(true),
);

function initializePhotoSlider() {
    const current = photoSlider
        ? photoSlider.realIndex % galleryPhotos.length
        : 0;
    const slideWidth = desktopViewport.matches ? 285.93 : 190;
    const minimum = 2 * (Math.ceil(photoElement.clientWidth / slideWidth) + 2);
    const count =
        Math.ceil(
            Math.max(minimum, galleryPhotos.length) / galleryPhotos.length,
        ) * galleryPhotos.length;
    if (photoSlider && photoTrack.children.length >= count) return;
    photoSlider?.destroy(true, true);
    photoTrack.replaceChildren();
    for (let i = 0; i < count; i++) {
        const slide = photoTemplates[i % galleryPhotos.length].cloneNode(true);
        photoTrack.append(slide);
    }
    photoSlider = new Swiper(photoElement, {
        slidesPerView: "auto",
        spaceBetween: 10,
        centeredSlides: true,
        initialSlide: current,
        breakpoints: {
            768: { spaceBetween: 7 },
        },
        loop: true,
        speed: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200,
        grabCursor: true,
        simulateTouch: true,
        keyboard: { enabled: !viewer.open, onlyInViewport: true },
        navigation: { nextEl: ".photos-next", prevEl: ".photos-prev" },
        on: { init: initSliderLoading },
        a11y: {
            slideLabelMessage: "Фотография",
            prevSlideMessage: "Предыдущая фотография",
            nextSlideMessage: "Следующая фотография",
        },
    });
}

if (photoTrack) {
    initializePhotoSlider();
    new ResizeObserver(initializePhotoSlider).observe(photoElement);
}
