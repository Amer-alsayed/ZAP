import { useEffect } from 'react';

/**
 * Hook for elastic overscroll bounce (rubber-banding) across all scrollable containers.
 * Uses exact spring physics (tension=0.08, damping=0.48) with visual clamp and requestAnimationFrame.
 * Fully supports desktop mousewheel/trackpad and mobile touch gestures without interfering with normal scrolling.
 * 
 * @param {React.RefObject<HTMLElement>} containerRef - The scrollable container element (overflow-y: auto)
 * @param {React.RefObject<HTMLElement>} wrapperRef - The inner content wrapper element that transforms
 * @param {boolean} [enabled=true] - Whether the bounce physics is active
 * @param {Array} [deps=[]] - Optional dependencies to re-bind when switching views/conversations
 */
export function useElasticBounce(containerRef, wrapperRef, enabled = true, deps = []) {
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef?.current;
    const wrapper = wrapperRef?.current;
    if (!container || !wrapper) return;

    let startY = 0;
    let isDragging = false;
    let isOverscrolling = false;

    // Physics engine state variables
    let position = 0;
    let velocity = 0;
    const tension = 0.08; // Stiffness of the spring
    const damping = 0.48; // Critically damped friction coefficient
    let rafId = null;

    // Reset translations
    wrapper.style.transform = 'translate3d(0px, 0px, 0px)';
    wrapper.style.transition = 'none';

    const updatePhysics = () => {
      if (isDragging) return;

      const force = -tension * position;
      const friction = -damping * velocity;
      const acceleration = force + friction;

      velocity += acceleration;
      position += velocity;

      const maxVisualOverscroll = 85;
      if (Math.abs(position) > maxVisualOverscroll) {
        position = Math.sign(position) * maxVisualOverscroll;
        velocity = 0;
      }

      wrapper.style.transform = `translate3d(0px, ${position}px, 0px)`;

      if (Math.abs(position) > 0.05 || Math.abs(velocity) > 0.05) {
        rafId = requestAnimationFrame(updatePhysics);
      } else {
        position = 0;
        velocity = 0;
        wrapper.style.transform = 'translate3d(0px, 0px, 0px)';
        rafId = null;
      }
    };

    const handleTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      startY = e.touches[0].clientY;
      isDragging = true;
      isOverscrolling = false;
    };

    const handleTouchMove = (e) => {
      if (!isDragging) return;

      const currentY = e.touches[0].clientY;
      const deltaY = currentY - startY;

      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;

      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1;

      // Only engage rubber band when pulling past the boundaries
      if (atTop && deltaY > 0) {
        isOverscrolling = true;
        if (e.cancelable) e.preventDefault();
        position = Math.sign(deltaY) * Math.pow(Math.abs(deltaY), 0.75);
        wrapper.style.transform = `translate3d(0px, ${position}px, 0px)`;
      } else if (atBottom && deltaY < 0) {
        isOverscrolling = true;
        if (e.cancelable) e.preventDefault();
        position = Math.sign(deltaY) * Math.pow(Math.abs(deltaY), 0.75);
        wrapper.style.transform = `translate3d(0px, ${position}px, 0px)`;
      } else {
        // Normal scroll inside content — allow native scrolling to run freely!
        if (isOverscrolling) {
          isOverscrolling = false;
          position = 0;
          wrapper.style.transform = 'translate3d(0px, 0px, 0px)';
        }
        startY = currentY;
      }
    };

    const handleTouchEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      isOverscrolling = false;
      velocity = 0;
      if (position !== 0 && !rafId) {
        rafId = requestAnimationFrame(updatePhysics);
      }
    };

    const handleWheel = (e) => {
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;

      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1;

      // Only intercept when wheeling past the edges!
      if (atTop && e.deltaY < 0) {
        // Scrolling up past top edge
        if (e.cancelable) e.preventDefault();
        velocity -= e.deltaY * 0.045;
        if (!rafId) {
          rafId = requestAnimationFrame(updatePhysics);
        }
      } else if (atBottom && e.deltaY > 0) {
        // Scrolling down past bottom edge
        if (e.cancelable) e.preventDefault();
        velocity -= e.deltaY * 0.045;
        if (!rafId) {
          rafId = requestAnimationFrame(updatePhysics);
        }
      }
      // If not at edge, do NOT preventDefault — let browser scroll normally!
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      wrapper.style.transform = 'translate3d(0px, 0px, 0px)';
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      container.removeEventListener('wheel', handleWheel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, wrapperRef, enabled, ...deps]);
}
