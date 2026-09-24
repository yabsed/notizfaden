import { mount } from 'svelte';
import { Capacitor } from '@capacitor/core';
import App from './App.svelte';
import './style.css';
mount(App, { target: document.getElementById('root')! });
if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
