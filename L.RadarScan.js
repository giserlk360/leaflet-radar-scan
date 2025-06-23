/**
 * L.RadarScan - 雷达扫描插件
 * 支持经典雷达屏幕效果，包含网格线、同心圆和渐变扫描
 * 基于 SVG 渲染，性能优化，支持地图缩放自适应
 *
 * @author: giserlk
 * @version: 1.0.0
 */

(function (window, document, undefined) {
    'use strict';

    if (typeof L === 'undefined') {
        throw new Error('Leaflet must be loaded before L.RadarScan');
    }

    L.RadarScan = L.Layer.extend({
        
        options: {
            // 基础配置
            center: null,
            radius: 1000,
            speed: 60,

            // 经典雷达样式
            classicMode: true,
            showGrid: true,
            showRangeRings: true,
            showBearingLines: true,

            // 扫描效果
            sweepAngle: 60,
            fadeTrail: true,
            trailLength: 90, // 尾迹长度（度）

            // 网格配置
            rangeRings: 4,
            bearingLines: 8,

            // 颜色主题
            radarColor: '#00ff00',
            backgroundColor: 'rgba(0, 20, 0, 0.9)',
            gridOpacity: 0.3,
            sweepOpacity: 0.6,

            // 扫描光束样式配置
            sweepOptions: {
                color: '#00ff00',
                opacity: 0.6,
                // 渐变配置
                gradient: {
                    enabled: true,
                    centerOpacity: 0.8,
                    edgeOpacity: 0,
                    // 渐变类型：'radial' 或 'linear'
                    type: 'radial'
                },
                // 尾迹效果
                trail: {
                    enabled: true,
                    length: 90, // 尾迹长度（度）
                    opacity: 0.3
                }
            },

            // 动画配置
            animationDuration: 3000, // 一圈扫描时间（毫秒）

            // 外圆（背景圆）样式配置
            backgroundCircleOptions: {
                fill: 'rgba(0, 20, 0, 0.9)',
                stroke: '#00ff00',
                strokeWidth: 2,
                strokeDasharray: null, // 虚线样式，如 '5,5'
                opacity: 0.8,
                radius: 45 // 相对于 SVG 的百分比半径
            },

            // 同心圆样式配置
            rangeRingOptions: {
                stroke: '#00ff00',
                strokeWidth: 1,
                strokeDasharray: null, // 虚线样式，如 '3,3'
                opacity: 0.6,
                fill: 'none',
                // 可以为每个圆圈设置不同样式
                individualStyles: null // 数组格式：[{stroke: '#ff0000'}, {stroke: '#00ff00'}]
            },

            // 方位线样式配置
            bearingLineOptions: {
                stroke: '#00ff00',
                strokeWidth: 1,
                strokeDasharray: null, // 虚线样式，如 '2,2'
                opacity: 0.5,
                // 线条长度配置
                innerRadius: 5, // 内半径百分比
                outerRadius: 45, // 外半径百分比
                // 可以为每条线设置不同样式
                individualStyles: null // 数组格式：[{stroke: '#ff0000'}, {stroke: '#00ff00'}]
            },

            // 中心点样式配置
            centerPointOptions: {
                fill: '#00ff00',
                stroke: null,
                strokeWidth: 0,
                radius: 3,
                opacity: 1,
                // 发光效果
                glow: {
                    enabled: true,
                    color: '#00ff00',
                    blur: 5,
                    spread: 0
                },
                // 脉冲效果
                pulse: {
                    enabled: false,
                    duration: 2000,
                    minOpacity: 0.3,
                    maxOpacity: 1
                }
            },

            // 数据点配置
            pointOptions: {
                color: '#00ff00',
                radius: 4,
                weight: 2,
                opacity: 1,
                fillColor: '#00ff00',
                fillOpacity: 0.8
            },

            // 脉冲效果
            pulseOptions: {
                enabled: true,
                duration: 1500,
                maxRadius: 15,
                color: '#ffff00'
            }
        },

        initialize: function (options) {
            // 先设置默认选项
            L.setOptions(this, options);
            
            if (!this.options.center) {
                throw new Error('RadarScan requires a center point');
            }
            
            // 如果设置了radarColor，应用到所有相关颜色配置
            if (this.options.radarColor) {
                this._applyRadarColor(this.options.radarColor);
            }
            
            // 内部状态
            this._isScanning = false;
            this._currentAngle = 0;
            this._animationId = null;
            this._lastTime = 0;
            
            // 图层组件
            this._radarGroup = null;
            this._svgElement = null;
            this._sweepElement = null;
            this._gridGroup = null;
            this._dataPoints = [];
            
            // SVG 命名空间
            this._svgNS = 'http://www.w3.org/2000/svg';
        },

        onAdd: function (map) {
            this._map = map;
            
            // 创建图层组
            this._radarGroup = L.layerGroup().addTo(map);
            
            // 创建 SVG 覆盖层
            this._createSVGOverlay();
            
            // 初始化雷达元素
            this._initRadarElements();
            
            // 绑定地图事件
            map.on('move zoom', this._updatePosition, this);
            
            return this;
        },

        onRemove: function (map) {
            this.stopScan();
            this._stopCenterPointPulse();

            if (this._radarGroup) {
                map.removeLayer(this._radarGroup);
                this._radarGroup = null;
            }

            // 清理引用
            this._centerPoint = null;
            this._backgroundCircle = null;
            this._gridGroup = null;
            this._sweepElement = null;
            this._svgElement = null;
            this._svgOverlay = null;

            map.off('move zoom', this._updatePosition, this);
            this._map = null;

            return this;
        },

        _createSVGOverlay: function () {
            // 计算 SVG 覆盖层的边界
            this._updateBounds();

            // 创建 SVG 元素
            this._svgElement = document.createElementNS(this._svgNS, 'svg');
            this._svgElement.style.pointerEvents = 'none';
            this._svgElement.setAttribute('viewBox', '0 0 100 100');
            this._svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');

            // 创建 SVG 覆盖层
            this._svgOverlay = L.svgOverlay(this._svgElement, this._bounds, {
                opacity: 1,
                interactive: false
            }).addTo(this._radarGroup);
        },

        _updateBounds: function () {
            // 根据当前地图缩放级别计算更精确的边界
            const center = L.latLng(this.options.center);
            const map = this._map;

            if (!map) {
                // 如果地图还没有初始化，使用默认计算
                const radiusInDegrees = this.options.radius / 111320;
                this._bounds = L.latLngBounds(
                    [center.lat - radiusInDegrees, center.lng - radiusInDegrees],
                    [center.lat + radiusInDegrees, center.lng + radiusInDegrees]
                );
                return;
            }

            // 使用地图的投影系统计算精确边界
            const centerPoint = map.latLngToLayerPoint(center);
            const zoom = map.getZoom();

            // 根据缩放级别计算像素半径
            const metersPerPixel = 40075016.686 * Math.abs(Math.cos(center.lat * Math.PI / 180)) / Math.pow(2, zoom + 8);
            const pixelRadius = this.options.radius / metersPerPixel;

            // 计算边界点
            const northPoint = L.point(centerPoint.x, centerPoint.y - pixelRadius);
            const southPoint = L.point(centerPoint.x, centerPoint.y + pixelRadius);
            const eastPoint = L.point(centerPoint.x + pixelRadius, centerPoint.y);
            const westPoint = L.point(centerPoint.x - pixelRadius, centerPoint.y);

            // 转换回经纬度
            const north = map.layerPointToLatLng(northPoint);
            const south = map.layerPointToLatLng(southPoint);
            const east = map.layerPointToLatLng(eastPoint);
            const west = map.layerPointToLatLng(westPoint);

            // 创建边界
            this._bounds = L.latLngBounds(
                [south.lat, west.lng],
                [north.lat, east.lng]
            );
        },

        _initRadarElements: function () {
            // 创建定义区域（用于渐变和遮罩）
            this._createDefs();
            
            // 创建背景圆
            this._createBackground();
            
            // 创建网格
            if (this.options.showGrid) {
                this._createGrid();
            }
            
            // 创建扫描扇形
            this._createSweepElement();
            
            // 创建中心点
            this._createCenterPoint();
        },

        _createDefs: function () {
            const defs = document.createElementNS(this._svgNS, 'defs');

            // 创建扫描渐变
            this._createSweepGradients(defs);

            this._svgElement.appendChild(defs);
        },

        _createSweepGradients: function (defs) {
            const sweepOptions = this.options.sweepOptions;
            const sweepColor = sweepOptions.color;

            // 创建径向渐变（用于扇形扫描）
            const sweepGradient = document.createElementNS(this._svgNS, 'radialGradient');
            sweepGradient.setAttribute('id', 'sweepGradient');
            sweepGradient.setAttribute('cx', '50%');
            sweepGradient.setAttribute('cy', '50%');

            const stop1 = document.createElementNS(this._svgNS, 'stop');
            stop1.setAttribute('offset', '0%');
            stop1.setAttribute('stop-color', sweepColor);
            stop1.setAttribute('stop-opacity', sweepOptions.gradient.centerOpacity);

            const stop2 = document.createElementNS(this._svgNS, 'stop');
            stop2.setAttribute('offset', '100%');
            stop2.setAttribute('stop-color', sweepColor);
            stop2.setAttribute('stop-opacity', sweepOptions.gradient.edgeOpacity);

            sweepGradient.appendChild(stop1);
            sweepGradient.appendChild(stop2);

            // 创建线性渐变（用于尾迹效果）
            const trailGradient = document.createElementNS(this._svgNS, 'linearGradient');
            trailGradient.setAttribute('id', 'trailGradient');
            trailGradient.setAttribute('x1', '0%');
            trailGradient.setAttribute('y1', '0%');
            trailGradient.setAttribute('x2', '100%');
            trailGradient.setAttribute('y2', '0%');

            const trailStop1 = document.createElementNS(this._svgNS, 'stop');
            trailStop1.setAttribute('offset', '0%');
            trailStop1.setAttribute('stop-color', sweepColor);
            trailStop1.setAttribute('stop-opacity', sweepOptions.trail.opacity);

            const trailStop2 = document.createElementNS(this._svgNS, 'stop');
            trailStop2.setAttribute('offset', '100%');
            trailStop2.setAttribute('stop-color', sweepColor);
            trailStop2.setAttribute('stop-opacity', '0');

            trailGradient.appendChild(trailStop1);
            trailGradient.appendChild(trailStop2);

            defs.appendChild(sweepGradient);
            defs.appendChild(trailGradient);
        },

        _createBackground: function () {
            const bgOptions = this.options.backgroundCircleOptions;
            const circle = document.createElementNS(this._svgNS, 'circle');

            circle.setAttribute('cx', '50%');
            circle.setAttribute('cy', '50%');
            circle.setAttribute('r', bgOptions.radius + '%');
            circle.setAttribute('fill', bgOptions.fill);
            circle.setAttribute('opacity', bgOptions.opacity);

            // 设置描边
            if (bgOptions.stroke) {
                circle.setAttribute('stroke', bgOptions.stroke);
                circle.setAttribute('stroke-width', bgOptions.strokeWidth);

                // 虚线样式
                if (bgOptions.strokeDasharray) {
                    circle.setAttribute('stroke-dasharray', bgOptions.strokeDasharray);
                }
            }

            this._backgroundCircle = circle;
            this._svgElement.appendChild(circle);
        },

        _createGrid: function () {
            this._gridGroup = document.createElementNS(this._svgNS, 'g');
            this._gridGroup.setAttribute('opacity', this.options.gridOpacity);

            // 创建同心圆
            if (this.options.showRangeRings) {
                this._createRangeRings();
            }

            // 创建方位线
            if (this.options.showBearingLines) {
                this._createBearingLines();
            }

            this._svgElement.appendChild(this._gridGroup);
        },

        _createRangeRings: function () {
            const ringOptions = this.options.rangeRingOptions;
            const bgRadius = this.options.backgroundCircleOptions.radius;

            for (let i = 1; i <= this.options.rangeRings; i++) {
                const circle = document.createElementNS(this._svgNS, 'circle');
                circle.setAttribute('cx', '50%');
                circle.setAttribute('cy', '50%');
                circle.setAttribute('r', (bgRadius * i / this.options.rangeRings) + '%');
                circle.setAttribute('fill', ringOptions.fill);

                // 获取当前圆圈的样式（可能是个别定制的）
                let currentStyle = ringOptions;
                if (ringOptions.individualStyles && ringOptions.individualStyles[i - 1]) {
                    currentStyle = Object.assign({}, ringOptions, ringOptions.individualStyles[i - 1]);
                }

                // 设置描边
                circle.setAttribute('stroke', currentStyle.stroke);
                circle.setAttribute('stroke-width', currentStyle.strokeWidth);
                circle.setAttribute('opacity', currentStyle.opacity);

                // 虚线样式
                if (currentStyle.strokeDasharray) {
                    circle.setAttribute('stroke-dasharray', currentStyle.strokeDasharray);
                }

                this._gridGroup.appendChild(circle);
            }
        },

        _createBearingLines: function () {
            const lineOptions = this.options.bearingLineOptions;

            for (let i = 0; i < this.options.bearingLines; i++) {
                const angle = (360 / this.options.bearingLines) * i;
                const line = document.createElementNS(this._svgNS, 'line');

                // 计算线条起点和终点
                const x1 = 50 + lineOptions.innerRadius * Math.cos((angle - 90) * Math.PI / 180);
                const y1 = 50 + lineOptions.innerRadius * Math.sin((angle - 90) * Math.PI / 180);
                const x2 = 50 + lineOptions.outerRadius * Math.cos((angle - 90) * Math.PI / 180);
                const y2 = 50 + lineOptions.outerRadius * Math.sin((angle - 90) * Math.PI / 180);

                line.setAttribute('x1', x1 + '%');
                line.setAttribute('y1', y1 + '%');
                line.setAttribute('x2', x2 + '%');
                line.setAttribute('y2', y2 + '%');

                // 获取当前线条的样式（可能是个别定制的）
                let currentStyle = lineOptions;
                if (lineOptions.individualStyles && lineOptions.individualStyles[i]) {
                    currentStyle = Object.assign({}, lineOptions, lineOptions.individualStyles[i]);
                }

                // 设置样式
                line.setAttribute('stroke', currentStyle.stroke);
                line.setAttribute('stroke-width', currentStyle.strokeWidth);
                line.setAttribute('opacity', currentStyle.opacity);

                // 虚线样式
                if (currentStyle.strokeDasharray) {
                    line.setAttribute('stroke-dasharray', currentStyle.strokeDasharray);
                }

                this._gridGroup.appendChild(line);
            }
        },

        _createSweepElement: function () {
            const sweepOptions = this.options.sweepOptions;

            // 创建扫描扇形路径
            this._sweepElement = document.createElementNS(this._svgNS, 'path');

            // 根据渐变配置设置填充
            if (sweepOptions.gradient.enabled) {
                this._sweepElement.setAttribute('fill', 'url(#sweepGradient)');
            } else {
                this._sweepElement.setAttribute('fill', sweepOptions.color);
            }

            this._sweepElement.setAttribute('opacity', sweepOptions.opacity);

            this._svgElement.appendChild(this._sweepElement);
            this._updateSweepPath();
        },

        _createCenterPoint: function () {
            const centerOptions = this.options.centerPointOptions;
            const centerPoint = document.createElementNS(this._svgNS, 'circle');

            centerPoint.setAttribute('cx', '50%');
            centerPoint.setAttribute('cy', '50%');
            centerPoint.setAttribute('r', centerOptions.radius);
            centerPoint.setAttribute('fill', centerOptions.fill);
            centerPoint.setAttribute('opacity', centerOptions.opacity);

            // 设置描边
            if (centerOptions.stroke) {
                centerPoint.setAttribute('stroke', centerOptions.stroke);
                centerPoint.setAttribute('stroke-width', centerOptions.strokeWidth);
            }

            // 发光效果
            if (centerOptions.glow.enabled) {
                const glowColor = centerOptions.glow.color;
                const blur = centerOptions.glow.blur;
                const spread = centerOptions.glow.spread;
                centerPoint.style.filter = `drop-shadow(${spread}px ${spread}px ${blur}px ${glowColor})`;
            }

            this._centerPoint = centerPoint;
            this._svgElement.appendChild(centerPoint);

            // 脉冲效果
            if (centerOptions.pulse.enabled) {
                this._startCenterPointPulse();
            }
        },

        _startCenterPointPulse: function () {
            // 停止现有的脉冲动画
            this._stopCenterPointPulse();

            const pulseOptions = this.options.centerPointOptions.pulse;
            const centerPoint = this._centerPoint;

            if (!centerPoint || !pulseOptions.enabled) return;

            const self = this;
            const duration = pulseOptions.duration || 2000;
            const minOpacity = pulseOptions.minOpacity || 0.3;
            const maxOpacity = pulseOptions.maxOpacity || 1;

            let startTime = performance.now();

            const pulse = () => {
                if (!self._centerPoint || !self.options.centerPointOptions.pulse.enabled) {
                    return; // 停止动画
                }

                const elapsed = performance.now() - startTime;
                const progress = (elapsed % duration) / duration;

                // 使用正弦波创建平滑的脉冲效果
                const opacity = minOpacity + (maxOpacity - minOpacity) *
                    (Math.sin(progress * Math.PI * 2) * 0.5 + 0.5);

                centerPoint.setAttribute('opacity', opacity);

                // 继续动画
                self._pulseAnimationId = requestAnimationFrame(pulse);
            };

            // 开始脉冲动画
            this._pulseAnimationId = requestAnimationFrame(pulse);
        },

        _stopCenterPointPulse: function () {
            if (this._pulseAnimationId) {
                cancelAnimationFrame(this._pulseAnimationId);
                this._pulseAnimationId = null;
            }
        },

        _updateSweepPath: function () {
            if (!this._sweepElement) return;
            
            const centerX = 50;
            const centerY = 50;
            const radius = 45;
            const startAngle = this._currentAngle - this.options.sweepAngle / 2;
            const endAngle = this._currentAngle + this.options.sweepAngle / 2;
            
            // 转换角度为弧度（SVG 中 0 度在右侧，我们需要调整为北向）
            const startRad = (startAngle - 90) * Math.PI / 180;
            const endRad = (endAngle - 90) * Math.PI / 180;
            
            // 计算扇形路径
            const x1 = centerX + radius * Math.cos(startRad);
            const y1 = centerY + radius * Math.sin(startRad);
            const x2 = centerX + radius * Math.cos(endRad);
            const y2 = centerY + radius * Math.sin(endRad);
            
            const largeArcFlag = this.options.sweepAngle > 180 ? 1 : 0;
            
            const pathData = [
                `M ${centerX} ${centerY}`,
                `L ${x1} ${y1}`,
                `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
                'Z'
            ].join(' ');
            
            this._sweepElement.setAttribute('d', pathData);
        },

        _updatePosition: function () {
            // 地图移动或缩放时更新位置和大小
            if (!this._svgOverlay || !this._map) return;

            // 重新计算边界
            this._updateBounds();

            // 更新 SVG 覆盖层的边界
            this._svgOverlay.setBounds(this._bounds);

            // 触发重绘
            if (this._svgOverlay._image) {
                this._svgOverlay._reset();
            }
        },

        // 开始扫描
        startScan: function () {
            if (this._isScanning) return;

            this._isScanning = true;
            this._lastTime = performance.now();
            this._animate();

            this.fire('scanstart');
        },

        // 停止扫描
        stopScan: function () {
            if (!this._isScanning) return;

            this._isScanning = false;

            if (this._animationId) {
                cancelAnimationFrame(this._animationId);
                this._animationId = null;
            }

            this.fire('scanstop');
        },

        // 动画循环
        _animate: function () {
            if (!this._isScanning) return;

            const currentTime = performance.now();
            const deltaTime = currentTime - this._lastTime;
            this._lastTime = currentTime;

            // 更新角度
            const angleIncrement = (360 * deltaTime) / this.options.animationDuration;
            this._currentAngle += angleIncrement;

            // 处理角度循环
            if (this._currentAngle >= 360) {
                this._currentAngle = this._currentAngle % 360;
                this.fire('scancomplete');
            }

            // 更新扫描元素
            this._updateSweepPath();

            // 检查数据点
            this._checkScannedPoints();

            // 继续动画
            this._animationId = requestAnimationFrame(this._animate.bind(this));
        },

        // 添加数据点
        addDataPoint: function (latlng, data, options) {
            options = L.extend({}, this.options.pointOptions, options);

            // 创建标记
            const marker = L.circleMarker(latlng, options).addTo(this._radarGroup);

            // 添加发光效果
            if (marker._path) {
                marker._path.style.filter = `drop-shadow(0 0 5px ${options.color})`;
            }

            // 添加到数据点数组
            const pointData = {
                latlng: latlng,
                data: data || {},
                marker: marker,
                scanned: false
            };

            this._dataPoints.push(pointData);

            return marker;
        },

        // 移除数据点
        removeDataPoint: function (marker) {
            this._radarGroup.removeLayer(marker);

            for (let i = this._dataPoints.length - 1; i >= 0; i--) {
                if (this._dataPoints[i].marker === marker) {
                    this._dataPoints.splice(i, 1);
                    break;
                }
            }
        },

        // 清除所有数据点
        clearDataPoints: function () {
            this._dataPoints.forEach(pointData => {
                this._radarGroup.removeLayer(pointData.marker);
            });
            this._dataPoints = [];
        },

        // 检查被扫描的数据点
        _checkScannedPoints: function () {
            const self = this;

            this._dataPoints.forEach(function (pointData) {
                if (pointData.scanned) return;

                const isInScan = self._isPointInScan(pointData.latlng);

                if (isInScan) {
                    pointData.scanned = true;
                    self._triggerPointScanned(pointData);
                }
            });
        },

        // 判断点是否在扫描范围内
        _isPointInScan: function (point) {
            const center = this.options.center;
            const radius = this.options.radius;

            // 检查距离
            const distance = this._calculateDistance(center, point);
            if (distance > radius) return false;

            // 检查角度
            const bearing = this._calculateBearing(center, point);
            const sweepAngle = this.options.sweepAngle;
            const startAngle = this._currentAngle - sweepAngle / 2;
            const endAngle = this._currentAngle + sweepAngle / 2;

            return this._isAngleInRange(bearing, startAngle, endAngle);
        },

        // 计算两点间距离
        _calculateDistance: function (point1, point2) {
            const lat1 = point1[0] * Math.PI / 180;
            const lng1 = point1[1] * Math.PI / 180;
            const lat2 = point2[0] * Math.PI / 180;
            const lng2 = point2[1] * Math.PI / 180;

            const earthRadius = 6371000;
            const dLat = lat2 - lat1;
            const dLng = lng2 - lng1;

            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(lat1) * Math.cos(lat2) *
                    Math.sin(dLng / 2) * Math.sin(dLng / 2);

            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

            return earthRadius * c;
        },

        // 计算方位角
        _calculateBearing: function (point1, point2) {
            const lat1 = point1[0] * Math.PI / 180;
            const lng1 = point1[1] * Math.PI / 180;
            const lat2 = point2[0] * Math.PI / 180;
            const lng2 = point2[1] * Math.PI / 180;

            const dLng = lng2 - lng1;

            const y = Math.sin(dLng) * Math.cos(lat2);
            const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

            const bearing = Math.atan2(y, x) * 180 / Math.PI;

            return (bearing + 360) % 360;
        },

        // 判断角度是否在范围内
        _isAngleInRange: function (angle, startAngle, endAngle) {
            angle = ((angle % 360) + 360) % 360;
            startAngle = ((startAngle % 360) + 360) % 360;
            endAngle = ((endAngle % 360) + 360) % 360;

            if (startAngle <= endAngle) {
                return angle >= startAngle && angle <= endAngle;
            } else {
                return angle >= startAngle || angle <= endAngle;
            }
        },

        // 触发点被扫描事件
        _triggerPointScanned: function (pointData) {
            // 创建脉冲效果
            if (this.options.pulseOptions.enabled) {
                this._createPulseEffect(pointData.latlng);
            }

            // 触发事件
            this.fire('pointscanned', {
                point: pointData.latlng,
                data: pointData.data,
                marker: pointData.marker
            });
        },

        // 创建脉冲效果
        _createPulseEffect: function (latlng) {
            const self = this;
            const pulseOptions = this.options.pulseOptions;

            const pulseCircle = L.circle(latlng, {
                radius: this.options.pointOptions.radius * 2,
                color: pulseOptions.color,
                weight: 2,
                opacity: 1,
                fillColor: pulseOptions.color,
                fillOpacity: 0.3
            }).addTo(this._radarGroup);

            // 动画参数
            const startTime = performance.now();
            const startRadius = this.options.pointOptions.radius * 2;
            const maxRadius = pulseOptions.maxRadius;
            const duration = pulseOptions.duration;

            function animatePulse() {
                const elapsed = performance.now() - startTime;
                const progress = elapsed / duration;

                if (progress >= 1) {
                    self._radarGroup.removeLayer(pulseCircle);
                    return;
                }

                const currentRadius = startRadius + (maxRadius - startRadius) * progress;
                const opacity = 1 - progress;

                pulseCircle.setRadius(currentRadius);
                pulseCircle.setStyle({
                    opacity: opacity,
                    fillOpacity: opacity * 0.3
                });

                requestAnimationFrame(animatePulse);
            }

            animatePulse();
        },

        // 重置扫描状态
        resetScan: function () {
            this._dataPoints.forEach(function (pointData) {
                pointData.scanned = false;
            });

            this._currentAngle = 0;
            this._updateSweepPath();
        },

        // 设置雷达中心点
        setCenter: function (center) {
            this.options.center = center;
            // 更新位置而不是重新创建
            this._updatePosition();
        },

        // 设置扫描半径
        setRadius: function (radius) {
            this.options.radius = radius;
            // 更新位置而不是重新创建
            this._updatePosition();
        },

        // 更新背景圆样式
        updateBackgroundCircleStyle: function (styleOptions) {
            if (!this._backgroundCircle) return;

            // 合并新样式
            Object.assign(this.options.backgroundCircleOptions, styleOptions);
            const bgOptions = this.options.backgroundCircleOptions;

            // 应用新样式
            this._backgroundCircle.setAttribute('fill', bgOptions.fill);
            this._backgroundCircle.setAttribute('opacity', bgOptions.opacity);
            this._backgroundCircle.setAttribute('r', bgOptions.radius + '%');

            if (bgOptions.stroke) {
                this._backgroundCircle.setAttribute('stroke', bgOptions.stroke);
                this._backgroundCircle.setAttribute('stroke-width', bgOptions.strokeWidth);

                if (bgOptions.strokeDasharray) {
                    this._backgroundCircle.setAttribute('stroke-dasharray', bgOptions.strokeDasharray);
                } else {
                    this._backgroundCircle.removeAttribute('stroke-dasharray');
                }
            }
        },

        // 更新同心圆样式
        updateRangeRingStyle: function (styleOptions, ringIndex = null) {
            if (!this._gridGroup) return;

            // 合并新样式
            Object.assign(this.options.rangeRingOptions, styleOptions);

            // 重新创建同心圆
            if (this.options.showRangeRings) {
                // 移除现有的同心圆
                const existingRings = this._gridGroup.querySelectorAll('circle');
                existingRings.forEach(ring => ring.remove());

                // 重新创建
                this._createRangeRings();
            }
        },

        // 更新方位线样式
        updateBearingLineStyle: function (styleOptions, lineIndex = null) {
            if (!this._gridGroup) return;

            // 合并新样式
            Object.assign(this.options.bearingLineOptions, styleOptions);

            // 重新创建方位线
            if (this.options.showBearingLines) {
                // 移除现有的方位线
                const existingLines = this._gridGroup.querySelectorAll('line');
                existingLines.forEach(line => line.remove());

                // 重新创建
                this._createBearingLines();
            }
        },

        // 更新中心点样式
        updateCenterPointStyle: function (styleOptions) {
            if (!this._centerPoint) return;

            // 停止现有的脉冲动画
            this._stopCenterPointPulse();

            // 合并新样式
            Object.assign(this.options.centerPointOptions, styleOptions);
            const centerOptions = this.options.centerPointOptions;

            // 应用新样式
            this._centerPoint.setAttribute('fill', centerOptions.fill);
            this._centerPoint.setAttribute('r', centerOptions.radius);

            if (centerOptions.stroke) {
                this._centerPoint.setAttribute('stroke', centerOptions.stroke);
                this._centerPoint.setAttribute('stroke-width', centerOptions.strokeWidth);
            } else {
                this._centerPoint.removeAttribute('stroke');
                this._centerPoint.removeAttribute('stroke-width');
            }

            // 更新发光效果
            if (centerOptions.glow && centerOptions.glow.enabled) {
                const glowColor = centerOptions.glow.color || centerOptions.fill;
                const blur = centerOptions.glow.blur || 5;
                const spread = centerOptions.glow.spread || 0;
                this._centerPoint.style.filter = `drop-shadow(${spread}px ${spread}px ${blur}px ${glowColor})`;
            } else {
                this._centerPoint.style.filter = 'none';
            }

            // 设置基础透明度（如果没有脉冲效果）
            if (!centerOptions.pulse || !centerOptions.pulse.enabled) {
                this._centerPoint.setAttribute('opacity', centerOptions.opacity);
            }

            // 启动脉冲效果（如果需要）
            if (centerOptions.pulse && centerOptions.pulse.enabled) {
                this._startCenterPointPulse();
            }
        },

        // 更新扫描光束样式
        updateSweepStyle: function (styleOptions) {
            if (!this._sweepElement) return;

            // 合并新样式
            Object.assign(this.options.sweepOptions, styleOptions);
            const sweepOptions = this.options.sweepOptions;

            // 更新扫描元素样式
            this._sweepElement.setAttribute('opacity', sweepOptions.opacity);

            // 更新填充样式
            if (sweepOptions.gradient.enabled) {
                this._sweepElement.setAttribute('fill', 'url(#sweepGradient)');
                // 重新创建渐变以应用新颜色
                this._updateSweepGradients();
            } else {
                this._sweepElement.setAttribute('fill', sweepOptions.color);
            }
        },

        _updateSweepGradients: function () {
            // 找到现有的渐变定义并更新
            const defs = this._svgElement.querySelector('defs');
            if (!defs) return;

            // 移除旧的渐变
            const oldSweepGradient = defs.querySelector('#sweepGradient');
            const oldTrailGradient = defs.querySelector('#trailGradient');
            if (oldSweepGradient) oldSweepGradient.remove();
            if (oldTrailGradient) oldTrailGradient.remove();

            // 重新创建渐变
            this._createSweepGradients(defs);
        },

        // 批量更新所有样式
        updateAllStyles: function (styleConfig) {
            if (styleConfig.backgroundCircle) {
                this.updateBackgroundCircleStyle(styleConfig.backgroundCircle);
            }

            if (styleConfig.rangeRings) {
                this.updateRangeRingStyle(styleConfig.rangeRings);
            }

            if (styleConfig.bearingLines) {
                this.updateBearingLineStyle(styleConfig.bearingLines);
            }

            if (styleConfig.centerPoint) {
                this.updateCenterPointStyle(styleConfig.centerPoint);
            }

            if (styleConfig.sweep) {
                this.updateSweepStyle(styleConfig.sweep);
            }
        },

        // 获取当前样式配置
        getStyleConfig: function () {
            return {
                backgroundCircle: this.options.backgroundCircleOptions,
                rangeRings: this.options.rangeRingOptions,
                bearingLines: this.options.bearingLineOptions,
                centerPoint: this.options.centerPointOptions,
                sweep: this.options.sweepOptions
            };
        },

        // 获取雷达扫描的边界
        getBounds: function() {
            // 如果已经计算了边界，直接返回
            if (this._bounds) {
                return this._bounds;
            }
            
            // 如果尚未计算边界，手动计算一次
            this._updateBounds();
            return this._bounds;
        },

        // 设置雷达全局颜色
        setRadarColor: function(color) {
            this.options.radarColor = color;
            this._applyRadarColor(color);
            
            // 如果雷达已经创建，更新现有元素的样式
            if (this._svgElement) {
                this.updateAllStyles({
                    backgroundCircle: { stroke: color },
                    rangeRings: { stroke: color },
                    bearingLines: { stroke: color },
                    centerPoint: {
                        fill: color,
                        glow: { color: color }
                    },
                    sweep: { color: color }
                });
            }
            
            return this;
        },

        // 应用雷达颜色到所有相关配置
        _applyRadarColor: function(color) {
            // 更新扫描光束颜色
            this.options.sweepOptions.color = color;
            if (this.options.sweepOptions.gradient && this.options.sweepOptions.gradient.enabled) {
                this.options.sweepOptions.gradient.color = color;
            }
            
            // 更新背景圆颜色
            this.options.backgroundCircleOptions.stroke = color;
            
            // 更新同心圆颜色
            this.options.rangeRingOptions.stroke = color;
            
            // 更新方位线颜色
            this.options.bearingLineOptions.stroke = color;
            
            // 更新中心点颜色
            this.options.centerPointOptions.fill = color;
            if (this.options.centerPointOptions.glow && this.options.centerPointOptions.glow.enabled) {
                this.options.centerPointOptions.glow.color = color;
            }
            
            // 更新数据点颜色
            this.options.pointOptions.color = color;
            this.options.pointOptions.fillColor = color;
        },
    });

    L.radarScan = function (options) {
        return new L.RadarScan(options);
    };

})(window, document);



