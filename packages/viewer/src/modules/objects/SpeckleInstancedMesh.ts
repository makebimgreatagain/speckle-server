import {
  BackSide,
  BufferGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Material,
  Matrix4,
  Ray,
  Raycaster,
  Sphere,
  Triangle,
  Vector2,
  Vector3
} from 'three'
import { BatchObject } from '../batching/BatchObject'
import Materials from '../materials/Materials'
import { TopLevelAccelerationStructure } from './TopLevelAccelerationStructure'
import InstancedMeshBatch, { DrawGroup } from '../batching/InstancedMeshBatch'
import { ObjectLayers } from '../../IViewer'
import Logger from 'js-logger'

const _inverseMatrix = new Matrix4()
const _ray = new Ray()
const _sphere = new Sphere()
const _vTemp = new Vector3()
const _vA = new Vector3()
const _vB = new Vector3()
const _vC = new Vector3()

const _tempA = new Vector3()
const _tempB = new Vector3()
const _tempC = new Vector3()

const _morphA = new Vector3()
const _morphB = new Vector3()
const _morphC = new Vector3()

const _uvA = new Vector2()
const _uvB = new Vector2()
const _uvC = new Vector2()

const _intersectionPoint = new Vector3()
const _intersectionPointWorld = new Vector3()

const ray = /* @__PURE__ */ new Ray()
const tmpInverseMatrix = /* @__PURE__ */ new Matrix4()

export default class SpeckleInstancedMesh extends Group {
  public static MeshBatchNumber = 0

  private tas: TopLevelAccelerationStructure = null
  private batchMaterial: Material = null
  private materialCache: { [id: string]: Material } = {}
  private materialStack: Array<Material | Material[]> = []

  private _batchObjects: BatchObject[]

  public groups: Array<DrawGroup> = []
  public materials: Material[] = []
  private instanceGeometry: BufferGeometry = null
  private instances: InstancedMesh[] = []

  public get TAS() {
    return this.tas
  }

  public get batchObjects(): BatchObject[] {
    return this._batchObjects
  }

  constructor(geometry: BufferGeometry) {
    super()
    this.instanceGeometry = geometry
    this.userData.raycastChildren = false
  }

  public setBatchMaterial(material: Material) {
    this.batchMaterial = material
    this.materialCache[material.id] = material
    this.materials.push(this.batchMaterial)
  }

  public setBatchObjects(batchObjects: BatchObject[]) {
    this._batchObjects = batchObjects
  }

  public setOverrideMaterial(material: Material) {
    material
    const saveMaterials = []
    for (let k = 0; k < this.instances.length; k++) {
      saveMaterials.push(this.instances[k].material)
    }
    this.materialStack.push(saveMaterials)

    const overrideMaterial = this.getCachedMaterial(material, true)
    this.instances.forEach((value) => (value.material = overrideMaterial))
  }

  public getCachedMaterial(material: Material, copy = false) {
    if (!this.materialCache[material.id]) {
      this.materialCache[material.id] = material.clone()
    } else if (copy || material['needsCopy']) {
      Materials.fastCopy(material, this.materialCache[material.id])
    }
    return this.materialCache[material.id]
  }

  public restoreMaterial() {
    if (this.materialStack.length > 0) {
      const restoreMaterials = this.materialStack.pop() as Material[]
      for (let k = 0; k < restoreMaterials.length; k++) {
        this.instances[k].material = restoreMaterials[k]
      }
    }
  }

  public buildTAS() {
    this.tas = new TopLevelAccelerationStructure(this.batchObjects)
    /** We do a refit here, because for some reason the bvh library incorrectly computes the total bvh bounds at creation,
     *  so we force a refit in order to get the proper bounds value out of it
     */
    this.tas.refit()
  }

  public updateDrawGroups(transformBuffer: Float32Array, gradientBuffer: Float32Array) {
    this.instances.forEach((value: InstancedMesh) => {
      this.remove(value)
      value.dispose()
    })
    this.instances.length = 0

    for (let k = 0; k < this.groups.length; k++) {
      const material = this.materials[this.groups[k].materialIndex]
      const group = new InstancedMesh(this.instanceGeometry, material, 0)
      group.instanceMatrix = new InstancedBufferAttribute(
        transformBuffer.subarray(
          this.groups[k].start,
          this.groups[k].start + this.groups[k].count
        ),
        InstancedMeshBatch.INSTANCE_TRANSFORM_BUFFER_STRIDE
      )
      group.geometry.setAttribute(
        'gradientIndex',
        new InstancedBufferAttribute(
          gradientBuffer.subarray(
            this.groups[k].start / InstancedMeshBatch.INSTANCE_TRANSFORM_BUFFER_STRIDE,
            (this.groups[k].start + this.groups[k].count) /
              InstancedMeshBatch.INSTANCE_TRANSFORM_BUFFER_STRIDE
          ),
          InstancedMeshBatch.INSTANCE_GRADIENT_BUFFER_STRIDE
        )
      )
      group.count =
        this.groups[k].count / InstancedMeshBatch.INSTANCE_TRANSFORM_BUFFER_STRIDE
      group.instanceMatrix.needsUpdate = true
      group.layers.set(ObjectLayers.STREAM_CONTENT_MESH)
      group.frustumCulled = false

      this.instances.push(group)
      this.add(group)
    }
    this.tas.refit()
    this.tas.getBoundingBox(this.tas.bounds)
  }

  public updateTransformsUniform() {
    let needsUpdate = false
    for (let k = 0; k < this._batchObjects.length; k++) {
      const batchObject = this._batchObjects[k]
      if (!(needsUpdate ||= batchObject.transformDirty)) continue
      const rv = batchObject.renderView
      const group = this.groups.find((value) => {
        return (
          rv.batchStart >= value.start &&
          rv.batchStart + rv.batchCount <= value.count + value.start
        )
      })
      if (group) {
        const instance: InstancedMesh = this.instances[this.groups.indexOf(group)]
        instance.setMatrixAt(
          (rv.batchStart - group.start) /
            InstancedMeshBatch.INSTANCE_TRANSFORM_BUFFER_STRIDE,
          batchObject.transform
        )

        instance.instanceMatrix.needsUpdate = true
      }
      batchObject.transformDirty = false
    }
    if (this.tas && needsUpdate) {
      this.tas.refit()
      this.tas.getBoundingBox(this.tas.bounds)
    }
  }

  public updateMaterialTransformsUniform(material: Material) {
    material
  }

  public getBatchObjectMaterial(batchObject: BatchObject) {
    const rv = batchObject.renderView
    const group = this.groups.find((value) => {
      return (
        rv.batchStart >= value.start &&
        rv.batchStart + rv.batchCount <= value.count + value.start
      )
    })
    if (!group) {
      Logger.warn(`Could not get material for ${batchObject.renderView.renderData.id}`)
      return null
    }
    return this.materials[group.materialIndex]
  }

  // converts the given BVH raycast intersection to align with the three.js raycast
  // structure (include object, world space distance and point).
  private convertRaycastIntersect(hit, object, raycaster) {
    if (hit === null) {
      return null
    }

    hit.point.applyMatrix4(object.matrixWorld)
    hit.distance = hit.point.distanceTo(raycaster.ray.origin)
    hit.object = object

    if (hit.distance < raycaster.near || hit.distance > raycaster.far) {
      return null
    } else {
      return hit
    }
  }

  raycast(raycaster: Raycaster, intersects) {
    if (this.tas) {
      if (this.batchMaterial === undefined) return

      tmpInverseMatrix.copy(this.matrixWorld).invert()
      ray.copy(raycaster.ray).applyMatrix4(tmpInverseMatrix)

      if (raycaster.firstHitOnly === true) {
        const hit = this.convertRaycastIntersect(
          this.tas.raycastFirst(ray, this.batchMaterial),
          this,
          raycaster
        )
        if (hit) {
          intersects.push(hit)
        }
      } else {
        const hits = this.tas.raycast(ray, this.batchMaterial)
        for (let i = 0, l = hits.length; i < l; i++) {
          const hit = this.convertRaycastIntersect(hits[i], this, raycaster)
          if (hit) {
            intersects.push(hit)
          }
        }
      }
    } else {
      const geometry = this.instanceGeometry
      const material = this.materials[0]
      const matrixWorld = this.matrixWorld

      if (material === undefined) return

      // Checking boundingSphere distance to ray

      if (geometry.boundingSphere === null) geometry.computeBoundingSphere()

      _sphere.copy(geometry.boundingSphere)
      _sphere.applyMatrix4(matrixWorld)

      if (raycaster.ray.intersectsSphere(_sphere) === false) return

      //

      _inverseMatrix.copy(matrixWorld).invert()
      _ray.copy(raycaster.ray).applyMatrix4(_inverseMatrix)

      // Check boundingBox before continuing

      if (geometry.boundingBox !== null) {
        if (_ray.intersectsBox(geometry.boundingBox) === false) return
      }

      let intersection

      const index = geometry.index
      /** Stored high component if RTE is being used. Regular positions otherwise */
      const position = geometry.attributes.position
      /** Stored low component if RTE is being used. undefined otherwise */
      const positionLow = geometry.attributes['position_low']
      const morphPosition = geometry.morphAttributes.position
      const morphTargetsRelative = geometry.morphTargetsRelative
      const uv = geometry.attributes.uv
      const uv2 = geometry.attributes.uv2
      const groups = geometry.groups
      const drawRange = geometry.drawRange

      if (index !== null) {
        // indexed buffer geometry

        if (Array.isArray(material)) {
          for (let i = 0, il = groups.length; i < il; i++) {
            const group = groups[i]
            const groupMaterial = material[group.materialIndex]

            const start = Math.max(group.start, drawRange.start)
            const end = Math.min(
              index.count,
              Math.min(group.start + group.count, drawRange.start + drawRange.count)
            )

            for (let j = start, jl = end; j < jl; j += 3) {
              const a = index.getX(j)
              const b = index.getX(j + 1)
              const c = index.getX(j + 2)

              intersection = checkBufferGeometryIntersection(
                this,
                groupMaterial,
                raycaster,
                _ray,
                positionLow,
                position,
                morphPosition,
                morphTargetsRelative,
                uv,
                uv2,
                a,
                b,
                c
              )

              if (intersection) {
                intersection.faceIndex = Math.floor(j / 3) // triangle number in indexed buffer semantics
                intersection.face.materialIndex = group.materialIndex
                intersects.push(intersection)
              }
            }
          }
        } else {
          const start = Math.max(0, drawRange.start)
          const end = Math.min(index.count, drawRange.start + drawRange.count)

          for (let i = start, il = end; i < il; i += 3) {
            const a = index.getX(i)
            const b = index.getX(i + 1)
            const c = index.getX(i + 2)

            intersection = checkBufferGeometryIntersection(
              this,
              material,
              raycaster,
              _ray,
              positionLow,
              position,
              morphPosition,
              morphTargetsRelative,
              uv,
              uv2,
              a,
              b,
              c
            )

            if (intersection) {
              intersection.faceIndex = Math.floor(i / 3) // triangle number in indexed buffer semantics
              intersects.push(intersection)
            }
          }
        }
      } else if (position !== undefined) {
        // non-indexed buffer geometry

        if (Array.isArray(material)) {
          for (let i = 0, il = groups.length; i < il; i++) {
            const group = groups[i]
            const groupMaterial = material[group.materialIndex]

            const start = Math.max(group.start, drawRange.start)
            const end = Math.min(
              position.count,
              Math.min(group.start + group.count, drawRange.start + drawRange.count)
            )

            for (let j = start, jl = end; j < jl; j += 3) {
              const a = j
              const b = j + 1
              const c = j + 2

              intersection = checkBufferGeometryIntersection(
                this,
                groupMaterial,
                raycaster,
                _ray,
                positionLow,
                position,
                morphPosition,
                morphTargetsRelative,
                uv,
                uv2,
                a,
                b,
                c
              )

              if (intersection) {
                intersection.faceIndex = Math.floor(j / 3) // triangle number in non-indexed buffer semantics
                intersection.face.materialIndex = group.materialIndex
                intersects.push(intersection)
              }
            }
          }
        } else {
          const start = Math.max(0, drawRange.start)
          const end = Math.min(position.count, drawRange.start + drawRange.count)

          for (let i = start, il = end; i < il; i += 3) {
            const a = i
            const b = i + 1
            const c = i + 2

            intersection = checkBufferGeometryIntersection(
              this,
              material,
              raycaster,
              _ray,
              positionLow,
              position,
              morphPosition,
              morphTargetsRelative,
              uv,
              uv2,
              a,
              b,
              c
            )

            if (intersection) {
              intersection.faceIndex = Math.floor(i / 3) // triangle number in non-indexed buffer semantics
              intersects.push(intersection)
            }
          }
        }
      }
    }
  }
}

function checkIntersection(object, material, raycaster, ray, pA, pB, pC, point) {
  let intersect

  if (material.side === BackSide) {
    intersect = ray.intersectTriangle(pC, pB, pA, true, point)
  } else {
    intersect = ray.intersectTriangle(pA, pB, pC, material.side !== DoubleSide, point)
  }

  if (intersect === null) return null

  _intersectionPointWorld.copy(point)
  _intersectionPointWorld.applyMatrix4(object.matrixWorld)

  const distance = raycaster.ray.origin.distanceTo(_intersectionPointWorld)

  if (distance < raycaster.near || distance > raycaster.far) return null

  return {
    distance,
    point: _intersectionPointWorld.clone(),
    object,
    uv: undefined,
    uv2: undefined,
    face: undefined
  }
}

/** If the geometry is non double->2floats encoded, the `positionHigh` argument will actually
 *  hold the default `position` attribute values
 */
function checkBufferGeometryIntersection(
  object,
  material,
  raycaster,
  ray,
  positionLow,
  positionHigh,
  morphPosition,
  morphTargetsRelative,
  uv,
  uv2,
  a,
  b,
  c
) {
  _vA.fromBufferAttribute(positionHigh, a)
  _vB.fromBufferAttribute(positionHigh, b)
  _vC.fromBufferAttribute(positionHigh, c)
  if (positionLow) {
    _vA.add(_vTemp.fromBufferAttribute(positionLow, a))
    _vB.add(_vTemp.fromBufferAttribute(positionLow, b))
    _vC.add(_vTemp.fromBufferAttribute(positionLow, c))
  }

  const morphInfluences = object.morphTargetInfluences

  if (morphPosition && morphInfluences) {
    _morphA.set(0, 0, 0)
    _morphB.set(0, 0, 0)
    _morphC.set(0, 0, 0)

    for (let i = 0, il = morphPosition.length; i < il; i++) {
      const influence = morphInfluences[i]
      const morphAttribute = morphPosition[i]

      if (influence === 0) continue

      _tempA.fromBufferAttribute(morphAttribute, a)
      _tempB.fromBufferAttribute(morphAttribute, b)
      _tempC.fromBufferAttribute(morphAttribute, c)

      if (morphTargetsRelative) {
        _morphA.addScaledVector(_tempA, influence)
        _morphB.addScaledVector(_tempB, influence)
        _morphC.addScaledVector(_tempC, influence)
      } else {
        _morphA.addScaledVector(_tempA.sub(_vA), influence)
        _morphB.addScaledVector(_tempB.sub(_vB), influence)
        _morphC.addScaledVector(_tempC.sub(_vC), influence)
      }
    }

    _vA.add(_morphA)
    _vB.add(_morphB)
    _vC.add(_morphC)
  }

  if (object.isSkinnedMesh) {
    object.boneTransform(a, _vA)
    object.boneTransform(b, _vB)
    object.boneTransform(c, _vC)
  }

  const intersection = checkIntersection(
    object,
    material,
    raycaster,
    ray,
    _vA,
    _vB,
    _vC,
    _intersectionPoint
  )

  if (intersection) {
    if (uv) {
      _uvA.fromBufferAttribute(uv, a)
      _uvB.fromBufferAttribute(uv, b)
      _uvC.fromBufferAttribute(uv, c)

      intersection.uv = Triangle.getUV(
        _intersectionPoint,
        _vA,
        _vB,
        _vC,
        _uvA,
        _uvB,
        _uvC,
        new Vector2()
      )
    }

    if (uv2) {
      _uvA.fromBufferAttribute(uv2, a)
      _uvB.fromBufferAttribute(uv2, b)
      _uvC.fromBufferAttribute(uv2, c)

      intersection.uv2 = Triangle.getUV(
        _intersectionPoint,
        _vA,
        _vB,
        _vC,
        _uvA,
        _uvB,
        _uvC,
        new Vector2()
      )
    }

    const face = {
      a,
      b,
      c,
      normal: new Vector3(),
      materialIndex: 0
    }

    Triangle.getNormal(_vA, _vB, _vC, face.normal)

    intersection.face = face
  }

  return intersection
}
