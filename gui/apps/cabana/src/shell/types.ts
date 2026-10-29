import type { Component } from 'solid-js';

export interface Step {
  id: string;
  label: string;
  panel?: Component;
}
