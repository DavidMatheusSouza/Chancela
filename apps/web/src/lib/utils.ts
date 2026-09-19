import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** The single class-merging helper. shadcn components and ours both use this. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
