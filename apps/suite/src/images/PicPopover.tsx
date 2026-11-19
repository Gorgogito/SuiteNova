import { Popover, PopoverSurface, PopoverTrigger } from '@fluentui/react-components';
import { Icon, t } from '@suitenova/core-ui';
import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import './images.css';

/** A ribbon button that opens a popover with a gallery or list of the shared picture tools (the products without their own gallery use it). */
export function PicPopover({ label, icon, size = 'small', iconOnly, children }: { label: string; icon: string; size?: 'large' | 'small'; iconOnly?: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={(_e, d) => setOpen(d.open)} positioning="below-start">
      <PopoverTrigger disableButtonEnhancement>
        <button type="button" className={`nv-btn nv-btn--${size}`} aria-haspopup="dialog" aria-label={t(label)} title={t(label)}>
          <Icon name={icon} />
          <span className="nv-btn__label">
            {!iconOnly && t(label)} <ChevronDown size={11} />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverSurface>{children(() => setOpen(false))}</PopoverSurface>
    </Popover>
  );
}
