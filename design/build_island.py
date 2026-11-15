import bpy, math, random, os, json
from mathutils import Vector
from mathutils.bvhtree import BVHTree
random.seed(714)
OUT=r'F:\source\my-jet-game\design'
original=bpy.context.scene
scene=bpy.data.scenes.new('Island Expansion - Review')
bpy.context.window.scene=scene
scene['status']='DESIGN REVIEW ONLY - not exported'
root=bpy.data.collections.new('NEW ISLAND - 7x land area')
scene.collection.children.link(root)
def mat(name,color):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=.88
 return m
mats=[mat(n,c) for n,c in [('Isle_Sand',(.68,.54,.32)),('Isle_Grass',(.25,.43,.12)),('Isle_Forest',(.15,.31,.10)),('Isle_Rock',(.34,.37,.36)),('Isle_Snow',(.76,.79,.75)),('Isle_Seabed',(.21,.36,.32)),('Isle_Water',(.035,.30,.40)),('Pine_Trunk',(.23,.13,.065)),('Pine_Leaf',(.075,.23,.12)),('Pine_Light',(.16,.34,.15)),('Road_Asphalt',(.16,.18,.17)),('Road_Shoulder',(.46,.40,.28)),('Wall_Cream',(.79,.69,.48)),('Wall_White',(.77,.79,.70)),('Wall_Ochre',(.64,.41,.22)),('Roof_Terracotta',(.43,.16,.075)),('Roof_Slate',(.16,.23,.26)),('Window_Dark',(.055,.15,.19)),('Paint_Ivory',(.88,.85,.65)),('Dock_Timber',(.33,.23,.13))]]
class Batch:
 def __init__(self):self.v=[];self.f=[];self.mi=[]
 def face(self,verts,mi):
  i=len(self.v);self.v.extend(verts);self.f.append(tuple(range(i,i+len(verts))));self.mi.append(mi)
 def box(self,x,y,z,w,d,h,mi):
  a=x-w/2;b=x+w/2;c=y-d/2;e=y+d/2;t=z+h
  for vs in [[(a,c,z),(a,e,z),(b,e,z),(b,c,z)],[(a,c,t),(b,c,t),(b,e,t),(a,e,t)],[(a,c,z),(b,c,z),(b,c,t),(a,c,t)],[(b,c,z),(b,e,z),(b,e,t),(b,c,t)],[(b,e,z),(a,e,z),(a,e,t),(b,e,t)],[(a,e,z),(a,c,z),(a,c,t),(a,e,t)]]:self.face(vs,mi)
 def cone(self,x,y,z,r,h,mi,sides=6):
  ring=[(x+r*math.cos(i*math.tau/sides),y+r*math.sin(i*math.tau/sides),z) for i in range(sides)]
  for i in range(sides):self.face([ring[i],ring[(i+1)%sides],(x,y,z+h)],mi)
 def object(self,name):
  me=bpy.data.meshes.new(name);me.from_pydata(self.v,[],self.f);me.update();ob=bpy.data.objects.new(name,me);root.objects.link(ob)
  for m in mats:me.materials.append(m)
  for p,mi in zip(me.polygons,self.mi):p.material_index=mi
  return ob
villages=[(-104,-39,5.1),(-12,-78,4.5),(107,-23,5.2),(83,56,6)]
def h(x,y):
 a=math.atan2(y/114,x/162)
 r=math.hypot(x/162,y/114)
 coast=1+.045*math.sin(5*a+.5)+.035*math.sin(9*a-1)+.02*math.cos(13*a)
 inland=coast-r
 if inland<-.08:return -7
 base=min(6, max(-7,inland*80))
 if inland>0:
  base+=1.25*math.sin(x*.043)*math.cos(y*.051)*min(1,inland*8)
  for px,py,amp,sx,sy in [(-91,49,48,22,27),(-65,70,37,25,21),(-117,17,24,16,18),(9,69,58,22,23),(37,82,30,19,17),(112,23,37,19,22),(-20,9,13,28,23)]:
   base+=amp*math.exp(-((x-px)/sx)**2-((y-py)/sy)**2)
  # Flat settlement terraces and the low central airfield.
  for vx,vy,level in villages+[(4,-28,5)]:
   dx=(x-vx)/(23 if vx!=4 else 18);dy=(y-vy)/(17 if vx!=4 else 40)
   d=math.hypot(dx,dy);blend=max(0,min(1,(1.35-d)/.5))
   base=base*(1-blend)+level*blend
 return base
terrain=Batch();step=3.5;nx=112;ny=84
grid=[]
for j in range(ny+1):
 row=[]
 for i in range(nx+1):
  x=(i-nx/2)*step;y=(j-ny/2)*step
  if 0<i<nx and 0<j<ny:x+=random.uniform(-.65,.65);y+=random.uniform(-.65,.65)
  row.append((x,y,h(x,y)))
 grid.append(row)
for j in range(ny):
 for i in range(nx):
  a,b,c,d=grid[j][i],grid[j][i+1],grid[j+1][i+1],grid[j+1][i]
  for tri in ([(a,b,c),(a,c,d)] if (i+j)%2 else [(a,b,d),(b,c,d)]):
   z=sum(v[2] for v in tri)/3;n=(Vector(tri[1])-Vector(tri[0])).cross(Vector(tri[2])-Vector(tri[0])).normalized()
   mi=5 if z<0 else 0 if z<2.6 else 4 if z>49 else 3 if z>27 or (n.z<.65 and z>13) else 2 if z>13 else 1
   terrain.face(tri,mi)
land=terrain.object('LowPolyIsland_Expanded')
area=sum(p.area*abs(p.normal.z) for p in land.data.polygons if p.center.z>0)
xy_scale=math.sqrt(7*7624.910242138132/area)
land['dry_land_area_before_scale']=area
bvh=BVHTree.FromPolygons([v.co for v in land.data.vertices],[tuple(p.vertices) for p in land.data.polygons])
def ground(x,y):
 p,n,idx,d=bvh.ray_cast(Vector((x,y,150)),Vector((0,0,-1)))
 return p.z if p else -7
# Sampled road ribbons sit on the actual triangulated ground, with gravel shoulders.
roads=Batch();routes=[]
loop=[(-104,-39),(-90,-65),(-48,-84),(-12,-78),(37,-70),(82,-56),(107,-23),(110,5),(82,12),(62,31),(70,53),(83,56),(57,45),(42,22),(19,5),(-23,-5),(-55,-9),(-86,-16),(-104,-39)]
def road(points,width=2.8):
 routes.append(points);samples=[]
 for a,b in zip(points,points[1:]):
  n=max(1,int(math.dist(a,b)/1.3))
  for i in range(n):samples.append((a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n))
 samples.append(points[-1])
 for a,b in zip(samples,samples[1:]):
  dx=b[0]-a[0];dy=b[1]-a[1];l=math.hypot(dx,dy)
  for w,mi,lift in [(width+1.4,11,.08),(width,10,.13)]:
   ox=-dy/l*w/2;oy=dx/l*w/2
   vs=[(a[0]-ox,a[1]-oy),(b[0]-ox,b[1]-oy),(b[0]+ox,b[1]+oy),(a[0]+ox,a[1]+oy)]
   roads.face([(x,y,ground(x,y)+lift) for x,y in vs],mi)
road(loop);road([(-12,-78),(-15,-55),(-15,-28),(-23,-5)],2.5)
road([(37,-70),(34,-38),(17,-28)],2.5)
for x,y,z in villages:road([(x-13,y),(x+13,y)],2.3)
# Buildings have pitched roofs, windows, doors and occasional chimneys.
build=Batch();footprints=[]
def house(x,y,w,d,ht,wall,roof):
 z=ground(x,y)+.1;footprints.append((x,y,max(w,d)/2+2))
 build.box(x,y,z-.45,w+.3,d+.3,.6,3);build.box(x,y,z,w,d,ht,wall)
 a=x-w/2-.3;b=x+w/2+.3;c=y-d/2-.3;e=y+d/2+.3;t=z+ht;r=t+min(w,d)*.45
 build.face([(a,c,t),(b,c,t),(b,y,r),(a,y,r)],roof);build.face([(a,y,r),(b,y,r),(b,e,t),(a,e,t)],roof)
 build.face([(a,c,t),(a,y,r),(a,e,t)],wall);build.face([(b,e,t),(b,y,r),(b,c,t)],wall)
 for xx in [x-w*.28,x+w*.28]:
  build.box(xx,y-d/2-.025,z+ht*.45,.55,.055,.6,17)
  build.box(xx,y+d/2+.025,z+ht*.45,.55,.055,.6,17)
 build.box(x,y-d/2-.05,z,.55,.09,1.25,19)
 if random.random()<.45:build.box(x+w*.25,y+d*.22,t,.45,.45,1.15,3)
for vi,(vx,vy,lev) in enumerate(villages):
 for side in [-1,1]:
  for k in range(6 if vi<3 else 4):
   x=vx+(k-2.5)*4.1;y=vy+side*random.uniform(4.2,6.3)
   house(x,y,random.uniform(2.4,3.4),random.uniform(2.7,3.8),random.uniform(2,3.3),12+random.randrange(3),15 if vi!=2 else 16)
 # A larger civic/storehouse landmark.
 house(vx+11,vy+10,5,4,4.4,13,16)
air=Batch();air.box(4,-28,5.05,8,57,.18,10)
for y in range(-52,-3,6):air.box(4,y,5.24,.3,2.5,.015,18)
for y in [-52,-4]:
 for x in [1.8,3.2,4.6,6]:air.box(x,y,5.25,.55,3,.02,18)
air.box(14,-24,5.05,11,17,.17,11)
house(18,-17,7,9,3.8,13,16);house(17,-37,3,3,5,13,16)
air.object('Central_Runway_and_Apron')
# Small southern timber harbour and waterside warehouse.
dock=Batch();dock.box(-15,-105,.8,18,3,.6,19);dock.box(-22,-113,.8,2,17,.6,19);dock.box(-8,-113,.8,2,17,.6,19)
for x in [-23,-16,-8]:
 for y in [-104,-111,-120]:dock.box(x,y,-2,.5,.5,3.6,19)
dock.object('South_Coast_Timber_Harbour')
road([(-12,-78),(-15,-94),(-15,-103)],2.5)
roads.object('Connected_Roads_and_Gravel_Shoulders')
build.object('Four_Villages_Houses_and_Civic_Buildings')
# Scatter vegetation away from roads, houses and the airfield.
trees=Batch();count=0
def distance_segment(x,y,a,b):
 dx=b[0]-a[0];dy=b[1]-a[1];t=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)))
 return math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)
segments=[(a,b) for path in routes for a,b in zip(path,path[1:])]
for attempt in range(17000):
 if count>=1050:break
 x=random.uniform(-164,164);y=random.uniform(-113,114);z=ground(x,y)
 if z<3.5 or z>30:continue
 if abs(x-4)<22 and abs(y+28)<39:continue
 if any(math.hypot(x-vx,y-vy)<r+1 for vx,vy,r in footprints):continue
 if any(distance_segment(x,y,a,b)<3.5 for a,b in segments):continue
 if any(abs(ground(x+dx,y+dy)-z)>2.2 for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)]):continue
 size=random.uniform(.75,1.5);trees.box(x,y,z,.32*size,.32*size,2.1*size,7)
 for dz,r,ht in [(1.0,1.35,3.3),(2.4,1.1,2.9)]:trees.cone(x,y,z+dz*size,r*size,ht*size,8 if random.random()<.7 else 9)
 count+=1
trees.object('Pine_Forests_1050_Trees')
rocks=Batch()
for i in range(130):
 x=random.uniform(-160,160);y=random.uniform(-108,108);z=ground(x,y)
 if z<2.5 or abs(x-4)<22 and abs(y+28)<40:continue
 if any(distance_segment(x,y,a,b)<4 for a,b in segments):continue
 rocks.cone(x,y,z-.2,random.uniform(.7,2),random.uniform(1,3),3,5)
rocks.object('Scattered_LowPoly_Boulders')
water=Batch();water.face([(-370,-310,-.14),(370,-310,-.14),(370,310,-.14),(-370,310,-.14)],6);water.object('LowPolyIsland_Water_Expanded')
# Scale horizontal extent to exactly seven times the measured original dry-land area.
for ob in root.objects:
 if ob.type=='MESH':
  for v in ob.data.vertices:v.co.x*=xy_scale;v.co.y*=xy_scale
scene['land_area_ratio']=7.0;scene['dry_land_area_source_units']=area*xy_scale**2;scene['tree_count']=count
scene['design_notes']='Four villages; connected road loop; northern mountain ridge; central airfield; southern harbour. Approval required before GLB export.'
world=bpy.data.worlds.new('Island Review Sky');world.use_nodes=True;world.node_tree.nodes.get('Background').inputs[0].default_value=(.44,.65,.8,1);world.node_tree.nodes.get('Background').inputs[1].default_value=.65;scene.world=world
ld=bpy.data.lights.new('Review Sun','SUN');lo=bpy.data.objects.new('Review Sun',ld);scene.collection.objects.link(lo);lo.rotation_euler=(.45,-.55,-.5);ld.energy=2.5;ld.angle=.2
camd=bpy.data.cameras.new('Review Camera');cam=bpy.data.objects.new('Review Camera',camd);scene.collection.objects.link(cam);scene.camera=cam
cam.location=(290,-360,340);target=Vector((0,0,9));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();camd.type='ORTHO';camd.ortho_scale=420*xy_scale
scene.render.resolution_x=1500;scene.render.resolution_y=1150;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
for screen in bpy.data.screens:
 for a in screen.areas:
  if a.type=='VIEW_3D':
   a.spaces.active.region_3d.view_distance=380*xy_scale;a.spaces.active.region_3d.view_location=(0,0,10);a.spaces.active.region_3d.view_rotation=cam.rotation_euler.to_quaternion();a.spaces.active.clip_end=3000;a.spaces.active.shading.color_type='MATERIAL'
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'island_expansion_review.blend'))
print(json.dumps({'saved':bpy.data.filepath,'land_area_ratio':7,'xy_adjustment':xy_scale,'trees':count,'mesh_objects':len([o for o in root.objects if o.type=='MESH']),'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in root.objects if o.type=='MESH')}))
