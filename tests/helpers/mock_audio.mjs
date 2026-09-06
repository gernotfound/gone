// tests/helpers/mock_audio.mjs
// High-fidelity Web Audio API mock for headless Node.js testing of procedural sound synthesizers.

export class MockAudioParam {
  constructor(defaultValue = 0) {
    this.value = defaultValue;
    this.events = [];
  }

  setValueAtTime(value, time) {
    this.value = value;
    this.events.push({ type: 'setValueAtTime', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push({ type: 'exponentialRampToValueAtTime', value, time });
    return this;
  }

  linearRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push({ type: 'linearRampToValueAtTime', value, time });
    return this;
  }

  cancelScheduledValues(time) {
    this.events.push({ type: 'cancelScheduledValues', time });
    return this;
  }
}

export class MockAudioNode {
  constructor(context, type = 'Node') {
    this.context = context;
    this.nodeType = type;
    this.connections = new Set();
    this.disconnected = false;
    this.disconnectCallCount = 0;
  }

  connect(destination) {
    this.connections.add(destination);
    return destination;
  }

  disconnect(destination) {
    this.disconnected = true;
    this.disconnectCallCount++;
    if (destination) {
      this.connections.delete(destination);
    } else {
      this.connections.clear();
    }
  }
}

export class MockGainNode extends MockAudioNode {
  constructor(context) {
    super(context, 'GainNode');
    this.gain = new MockAudioParam(1.0);
  }
}

export class MockBiquadFilterNode extends MockAudioNode {
  constructor(context) {
    super(context, 'BiquadFilterNode');
    this.type = 'lowpass';
    this.frequency = new MockAudioParam(350);
    this.Q = new MockAudioParam(1);
    this.gain = new MockAudioParam(0);
  }
}

export class MockDynamicsCompressorNode extends MockAudioNode {
  constructor(context) {
    super(context, 'DynamicsCompressorNode');
    this.threshold = new MockAudioParam(-24);
    this.knee = new MockAudioParam(30);
    this.ratio = new MockAudioParam(12);
    this.attack = new MockAudioParam(0.003);
    this.release = new MockAudioParam(0.25);
  }
}

export class MockAudioScheduledSourceNode extends MockAudioNode {
  constructor(context, type = 'Source') {
    super(context, type);
    this.started = false;
    this.startTime = null;
    this.startOffset = 0;
    this.stopped = false;
    this.stopTime = null;
    this.onended = null;
  }

  start(time = 0, offset = 0) {
    this.started = true;
    this.startTime = time;
    this.startOffset = offset;
  }

  stop(time = 0) {
    this.stopped = true;
    this.stopTime = time;
  }

  triggerEnded() {
    if (this.onended) {
      this.onended();
    }
  }
}

export class MockOscillatorNode extends MockAudioScheduledSourceNode {
  constructor(context) {
    super(context, 'OscillatorNode');
    this.type = 'sine';
    this.frequency = new MockAudioParam(440);
    this.detune = new MockAudioParam(0);
  }
}

export class MockAudioBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this._data = Array.from({ length: channels }, () => new Float32Array(length));
  }

  getChannelData(channelIndex) {
    return this._data[channelIndex];
  }
}

export class MockAudioBufferSourceNode extends MockAudioScheduledSourceNode {
  constructor(context) {
    super(context, 'AudioBufferSourceNode');
    this.buffer = null;
    this.loop = false;
  }
}

export class MockAudioContext {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0.05;
    this.sampleRate = 44100;
    this.destination = new MockAudioNode(this, 'Destination');
    this.createdNodes = [];
  }

  createGain() {
    const node = new MockGainNode(this);
    this.createdNodes.push(node);
    return node;
  }

  createOscillator() {
    const node = new MockOscillatorNode(this);
    this.createdNodes.push(node);
    return node;
  }

  createBiquadFilter() {
    const node = new MockBiquadFilterNode(this);
    this.createdNodes.push(node);
    return node;
  }

  createDynamicsCompressor() {
    const node = new MockDynamicsCompressorNode(this);
    this.createdNodes.push(node);
    return node;
  }

  createBuffer(channels, length, sampleRate) {
    return new MockAudioBuffer(channels, length, sampleRate);
  }

  createBufferSource() {
    const node = new MockAudioBufferSourceNode(this);
    this.createdNodes.push(node);
    return node;
  }

  async resume() {
    this.state = 'running';
  }

  async suspend() {
    this.state = 'suspended';
  }

  async close() {
    this.state = 'closed';
  }
}
