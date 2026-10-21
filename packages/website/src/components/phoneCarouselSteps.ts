/**
 * Wires a rendered PhoneCarousel's step buttons. Each step scrolls by the
 * phones that fit, so a press never skips one only partly seen, and each button
 * disables at its end of the row. The buttons stay hidden until this runs, so
 * without JavaScript the row simply scrolls.
 */
export function initPhoneCarouselSteps(
  carousel: HTMLElement,
  prefersReducedMotion: () => boolean,
): void {
  const track = carousel.querySelector<HTMLElement>("[data-track]");
  const steps = carousel.querySelector<HTMLElement>("[data-steps]");
  const slide = carousel.querySelector<HTMLElement>(".phone-carousel-slide");
  if (!track || !steps || !slide) return;
  const buttons = [...steps.querySelectorAll<HTMLButtonElement>("[data-step]")];
  const update = () => {
    const end = track.scrollWidth - track.clientWidth;
    for (const button of buttons) {
      button.disabled =
        button.dataset.step === "1"
          ? track.scrollLeft >= end - 1
          : track.scrollLeft <= 1;
    }
  };
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const gap = Number.parseFloat(
        getComputedStyle(slide.parentElement ?? slide).columnGap,
      );
      const pitch =
        slide.getBoundingClientRect().width + (Number.isFinite(gap) ? gap : 0);
      const fit = Math.max(1, Math.floor(track.clientWidth / pitch));
      track.scrollBy({
        left: Number(button.dataset.step) * fit * pitch,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    });
  }
  track.addEventListener("scroll", update, { passive: true });
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(update).observe(track);
  }
  steps.hidden = false;
  update();
}
