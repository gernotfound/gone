import './style.css';
import { bootstrap } from './gameplay/engine.ts';
import { startHostRemoteSync } from './net/hostRemoteSync.ts';

bootstrap();
startHostRemoteSync();
